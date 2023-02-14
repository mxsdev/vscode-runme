import {
  CreateSessionRequest,
  ExecuteRequest,
  ExecuteResponse,
  Session,
} from '@buf/stateful_runme.community_timostamm-protobuf-ts/runme/runner/v1/runner_pb'
import { ChannelCredentials } from '@grpc/grpc-js'
import { GrpcTransport } from '@protobuf-ts/grpc-transport'
import { DuplexStreamingCall } from '@protobuf-ts/runtime-rpc/build/types/duplex-streaming-call'
import {
  commands,
  window,
  ExtensionContext,
  ExtensionTerminalOptions,
  Pseudoterminal,
  Event,
  TerminalDimensions,
  EventEmitter,
  Disposable,
} from 'vscode'

import { RunnerServiceClient } from './grpc/client'
import { UInt32Value } from '@buf/stateful_runme.community_timostamm-protobuf-ts/google/protobuf/wrappers_pb'
import type { DisposableAsync } from '../types'

type ExecuteDuplex = DuplexStreamingCall<ExecuteRequest, ExecuteResponse>

export interface RunProgramOptions {
  programName: string
  args?: string[]
  cwd?: string
  envs?: string[]
  script?: 
    |{
      type: 'commands',
      commands: string[]
    }
    |{
      type: 'script',
      script: string
    }
  tty?: boolean
  background?: boolean
  environment?: IRunnerEnvironment
}

export interface IRunner extends Disposable {
  close(): void

  createEnvironment(
    envs?: string[],
    metadata?: { [index: string]: string }
  ): Promise<IRunnerEnvironment>

  createProgramSession(): Promise<IRunnerProgramSession>
}

export interface IRunnerEnvironment extends DisposableAsync { }

export interface IRunnerProgramSession extends DisposableAsync, Pseudoterminal {
  readonly onDidErr: Event<string>
  readonly onDidClose: Event<void | number>;

  readonly onStdoutRaw: Event<Uint8Array>
  readonly onStderrRaw: Event<Uint8Array>

  handleInput(message: string): Promise<void>

  run(opts: RunProgramOptions): Promise<void>
}

export class GrpcRunner implements IRunner {
  protected readonly client: RunnerServiceClient
  protected transport: GrpcTransport

  private children: WeakRef<DisposableAsync>[] = []

  constructor() {
    this.transport = new GrpcTransport({
      host: 'unix:///tmp/runme.sock',
      channelCredentials: ChannelCredentials.createInsecure(),
    })

    this.client = new RunnerServiceClient(this.transport)
  }

  async createProgramSession(): Promise<IRunnerProgramSession> {
    const session = new GrpcRunnerProgramSession(
      this.client
    )

    this.registerChild(session)

    return session
  }

  createEnvironment(
    envs?: string[],
    metadata?: { [index: string]: string }
  ) {
    console.debug(`Connecting to GRPC endpoint...\n\r`)

    const request = <CreateSessionRequest>{ 
      metadata, envs
    }

    try {
      return this.client
        .createSession(request)
        .then(({ response: { session } }) => {
          if(!session) {
            throw new Error("Did not receive session!!")
          }

          const environment = new GrpcRunnerEnvironment(
            this.client,
            session
          )

          this.registerChild(environment)
          return environment
        })
        .catch((e) => {
          throw e
        })
    } catch (err: any) {
      console.error(err)
      this.close()
      throw err
    }
  }

  close(): void {
    this.transport.close()
  }

  async dispose(): Promise<void> {
    await Promise.all(
      this.children.map(c => c.deref()?.dispose())
    ).then(() => this.close())
  }

  /**
   * Register disposable child weakref, so that it can still be GC'ed even if
   * there is a reference to it in this object and its already been disposed of
   */
  protected registerChild(d: DisposableAsync) {
    this.children.push(new WeakRef(d))
  }
}

// TODO: this should not be allowed to run anything if the parent (GrpcRunner)
// runs `close` 
export class GrpcRunnerProgramSession implements IRunnerProgramSession {
  readonly _onDidWrite  = this.register(new EventEmitter<string>())
  readonly _onDidErr    = this.register(new EventEmitter<string>())
  readonly _onDidClose  = this.register(new EventEmitter<number|void>())
  readonly _onStdoutRaw = this.register(new EventEmitter<Uint8Array>())
  readonly _onStderrRaw = this.register(new EventEmitter<Uint8Array>())
  
  readonly onDidWrite = this._onDidWrite.event
  readonly onDidErr = this._onDidErr.event
  readonly onDidClose = this._onDidClose.event
  readonly onStdoutRaw = this._onStdoutRaw.event
  readonly onStderrRaw = this._onStderrRaw.event

  private readonly session: ExecuteDuplex

  private exitCode: UInt32Value|undefined

  private disposables: Disposable[] = []
  private isDisposed = false

  protected initialized = false

  constructor(
    private readonly client: RunnerServiceClient,
    protected opts?: RunProgramOptions
  ) { 
    this.session = client.execute()

    this.register(
      this._onStdoutRaw.event((data) => {
        // TODO: web compat
        const stdout = Buffer.from(data).toString('utf-8') 
        this._onDidWrite.fire(stdout)
      })
    )

    this.register(
      this._onStderrRaw.event((data) => {
        // TODO: web compat
        const stderr = Buffer.from(data).toString('utf-8') 
        this._onDidErr.fire(stderr)
      })
    )

    this.session.responses.onMessage(({ stderrData, stdoutData, exitCode }) => {
      if(stdoutData.length > 0) {
        this._onStdoutRaw.fire(stdoutData)
      }
      
      if(stderrData.length > 0) {
        this._onStderrRaw.fire(stderrData)
      }

      if(exitCode) {
        this.close(exitCode)
      }
    })

    this.session.responses.onComplete(() => {
      this.dispose(false)
    })

    this.session.responses.onError((reason) => {
      // TODO: maybe just log here?
      throw reason
    })

    if(opts && !opts.tty) {
      // if we are a pseudoterminal, wait for terminal open before starting
      this.init()
    }
  }

  protected init(opts?: RunProgramOptions) {
    if(!(opts || this.opts)) { throw new Error("No run options!") }
    if(this.initialized) { throw new Error("Already initialized!") }
    this.opts ??= opts

    this.initialized = true

    return this.session.requests.send(GrpcRunnerProgramSession.runOptionsToExecuteRequest(this.opts!))
  }

  async run(opts: RunProgramOptions): Promise<void> {
    await this.init(opts)
  }

  async handleInput(data: string): Promise<void> {
    if(this.hasExited()) throw new Error("Cannot write to closed program session!")
    this.sendRawInput(data)

    // TODO: pseudoterminal support
    // if(this.isPseudoterminal && !this.isRunning()) {
    //   switch (data) {
    //     case '\r': // Enter
    //       const command = this.buffer + '\n'
  
    //       // lastCommand = buffer
    //       this.buffer = ''
  
    //       console.log('sending input', command)
  
    //       this.sendRawInput(command)
    //         // .then(() => console.log('sent input', command))
    //       break
    //     case '\u007F': // Backspace (DEL)
    //       if (this.buffer.length > 0) {
    //         this._onDidWrite.fire('\b \b')
    //         if (this.buffer.length > 0) {
    //           this.buffer = this.buffer.slice(0, this.buffer.length - 1)
    //         }
    //       }
    //       break
    //     case '\u0003': // Ctrl+C
    //       this._onDidWrite.fire('^C')
    //       break
    //     default:
    //       if (
    //         (data >= String.fromCharCode(0x20) &&
    //           data <= String.fromCharCode(0x7e)) ||
    //         data >= '\u00a0'
    //       ) {
    //         this.buffer += data
    //         this._onDidWrite.fire(data)
    //       }
    //   }
    // } else {
    //   this.sendRawInput(data)
    // }
  }

  protected async sendRawInput(data: string) {
    this.session.requests.send(<ExecuteRequest>{
      // TODO: web compat
      inputData: new Uint8Array(Buffer.from(data, 'utf-8'))
    })
  }

  open(initialDimensions: TerminalDimensions | undefined): void { }

  async dispose(endSession = true) {
    if(this.isDisposed) return

    if(endSession) {
      await this.session.requests.complete()
    }
  }

  /**
   * If `code` is undefined, this was closed manually by the user
   */
  close(code?: UInt32Value) {
    this._onDidClose.fire(code?.value)
    this.exitCode = code
    this.dispose()
  }

  private hasExited() {
    return this.exitCode !== undefined || this.isDisposed
  }

  protected register<T extends Disposable>(disposable: T): T {
    this.disposables.push(disposable)
    return disposable
  }

  static runOptionsToExecuteRequest(
    { programName, args, cwd, environment, script, tty, background, envs }: RunProgramOptions
  ): ExecuteRequest {
    if(environment && !(environment instanceof GrpcRunnerEnvironment)) {
      throw new Error("Expected gRPC environment!")
    }
    
    return <Partial<ExecuteRequest>>{
      arguments: args,
      envs,
      background,
      directory: cwd,
      tty,
      sessionId: environment?.getSessionId(),
      programName,
      ...script?.type === 'commands' && { commands: script.commands },
      ...script?.type === 'script' && { script: script.script },
    } as unknown as ExecuteRequest
  }
}

// TODO: this should not be allowed to run anything if the parent (GrpcRunner)
// runs `close` 
export class GrpcRunnerEnvironment implements IRunnerEnvironment {
  constructor(
    private readonly client: RunnerServiceClient,
    private readonly session: Session
  ) { }

  getRunmeSession(): Session {
    return this.session
  }

  getSessionId(): string {
    return this.session.id
  }

  async dispose() {
    await this.delete()
  }

  private delete() {
    return this.client.deleteSession({ id: this.getSessionId() })
  }
}
