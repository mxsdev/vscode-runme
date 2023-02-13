import {
  Session,
} from '../../gen/runme/runner/v1/runner_pb'
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
} from 'vscode'

import { KernelServiceClient } from '../grpc/client'

type IODuplex = DuplexStreamingCall<IORequest, IOResponse>
export class PocTerminal implements Pseudoterminal {
  protected readonly host = 'localhost:8080'
  protected readonly client: KernelServiceClient
  protected readonly transport: GrpcTransport
  protected session?: Session
  protected duplex: IODuplex
  protected buffer: string = ''

  readonly writeEmitter = new EventEmitter<string>()
  readonly closeEmitter = new EventEmitter<number>()

  onDidWrite: Event<string> = this.writeEmitter.event
  onDidClose?: Event<number> = this.closeEmitter.event

  constructor() {
    this.transport = new GrpcTransport({
      host: this.host,
      channelCredentials: ChannelCredentials.createInsecure(),
    })

    this.client = new KernelServiceClient(this.transport)
    this.duplex = this.init()
  }

  init() {
    this.writeEmitter.fire(`Connecting to GRPC endpoint ${this.host}\n\r`)
    const request = <PostSessionRequest>{
      command: '/bin/bash',
      prompt: 'bash-3.2$',
    }

    try {
      this.client
        .postSession(request)
        .then((call) => {
          this.buffer = call.response.introData.toString() + ' '
          this.session = call.response.session!
        })
        .catch((e) => {
          throw e
        })
      return this.client.iO()
    } catch (err: any) {
      console.error(err)
      this.close()
      throw err
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async open(initialDimensions?: TerminalDimensions): Promise<void> {
    try {
      this.duplex.responses.onMessage((msg) =>
        this.writeEmitter.fire(msg.data.toString())
      )

      if (this.buffer.length > 0) {
        this.writeEmitter.fire(this.buffer)
        this.buffer = ''
      }
    } catch (err: any) {
      console.error(err)
      this.close()
      throw err
    }
  }

  static prepRequest(id: string, cmd: string) {
    return <IORequest>{
      sessionId: id,
      data: Buffer.from(cmd),
    }
  }

  close(): void {
    this.transport.close()
  }

  handleInput(data: string): void {
    // const CR = '\x0D'
    const EOF = '\x03'
    if (data === EOF) {
      // return this.#closeEmitter.fire(-1)
      this.close()
      return
    }
    // this.writeEmitter.fire(`${data === CR ? '\n\r' : data}`)

    switch (data) {
      case '\r': // Enter
        const command = this.buffer + '\n'

        // lastCommand = buffer
        this.buffer = ''

        console.log('sending input', command)

        this.duplex.requests
          .send(PocTerminal.prepRequest(this.session!.id, command))
          .then(() => console.log('sent input', command))
        break
      case '\u007F': // Backspace (DEL)
        if (this.buffer.length > 0) {
          this.writeEmitter.fire('\b \b')
          if (this.buffer.length > 0) {
            this.buffer = this.buffer.slice(0, this.buffer.length - 1)
          }
        }
        break
      case '\u0003': // Ctrl+C
        this.writeEmitter.fire('^C')
        break
      default:
        if (
          (data >= String.fromCharCode(0x20) &&
            data <= String.fromCharCode(0x7e)) ||
          data >= '\u00a0'
        ) {
          this.buffer += data
          this.writeEmitter.fire(data)
        }
    }
  }
}

export default function (context: ExtensionContext) {
  context.subscriptions.push(
    commands.registerCommand('runme.pocTerminal', () => {
      const pty = new PocTerminal()
      const options = <ExtensionTerminalOptions>{
        name: 'Poc',
        pty,
        isTransient: true,
      }

      const t = window.createTerminal(options)
      t.show()
    })
  )
}
