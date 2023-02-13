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

  run(
    opts: RunProgramOptions
  ): Promise<IRunnerProgramSession>
}

export interface IRunnerEnvironment extends DisposableAsync {
  getRunmeSession(): Session
  getSessionId(): string
}

export interface IRunnerProgramSession extends DisposableAsync, Pseudoterminal {
  // readonly onWrite: Event<string>
  // readonly onClose: Event<UInt32Value>
  readonly onDidErr: Event<string>

  handleInput(message: string): Promise<void>
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

  async run(
    opts: RunProgramOptions
  ): Promise<IRunnerProgramSession> {
    const session = new GrpcRunnerProgramSession(
      this.client,
      opts
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
  readonly _onDidWrite = new EventEmitter<string>()
  readonly _onDidErr = new EventEmitter<string>()
  readonly _onDidClose = new EventEmitter<number|void>()
  
  readonly onDidWrite = this._onDidWrite.event
  readonly onDidErr = this._onDidErr.event
  readonly onDidClose = this._onDidClose.event

  private readonly session: ExecuteDuplex

  private exitCode: UInt32Value|undefined

  private isDisposed = false

  // protected buffer = ''

  constructor(
    private readonly client: RunnerServiceClient,
    protected readonly opts: RunProgramOptions
  ) { 
    this.session = client.execute()

    this.session.responses.onMessage(({ stderrData, stdoutData, exitCode }) => {
      // TODO: web compat
      const stderr = Buffer.from(stderrData).toString('utf-8')
      const stdout = Buffer.from(stdoutData).toString('utf-8')

      if(stdout) {
        this._onDidWrite.fire(stdout)
      }
      
      if(stderr) {
        this._onDidErr.fire(stderr)
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

    if(!opts.tty) {
    // if we are a pseudoterminal, wait for terminal open before starting
      this.init()
    }
  }

  protected init() {
    this.session.requests.send(GrpcRunnerProgramSession.runOptionsToExecuteRequest(this.opts))
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

  open(initialDimensions: TerminalDimensions | undefined): void {
    // if we are a pseudoterminal, wait for terminal open before starting
    this.init()
  }

  async dispose(endSession = true) {
    if(this.isDisposed) return

    if(endSession) {
      await this.session.requests.complete()
    }
  }

  close(code?: UInt32Value) {
    this._onDidClose.fire(code?.value)
    this.exitCode = code
    this.dispose()
  }

  private hasExited() {
    return this.exitCode !== undefined || this.isDisposed
  }

  static runOptionsToExecuteRequest(
    { programName, args, cwd, environment, script, tty, background, envs }: RunProgramOptions
  ): ExecuteRequest {
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

// export default function (context: ExtensionContext) {
  // context.subscriptions.push(
    // commands.registerCommand('runme.pocTerminal', () => {
    //   const pty = new PocTerminal()
    //   const options = <ExtensionTerminalOptions>{
    //     name: 'Poc',
    //     pty,
    //     isTransient: true,
    //   }

    //   const t = window.createTerminal(options)
    //   t.show()
    // })
  // )
// }
