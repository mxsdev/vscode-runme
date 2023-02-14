import path from 'node:path'

import {
  Disposable, notebooks, window, workspace, ExtensionContext,
  NotebookEditor, NotebookCell, NotebookCellKind, NotebookCellExecution, WorkspaceEdit, NotebookEdit, NotebookDocument, NotebookCellOutputItem, NotebookCellOutput, Task, TaskScope, CustomExecution, TaskRevealKind, TaskPanelKind, tasks
} from 'vscode'
import { TelemetryReporter } from 'vscode-telemetry'

import type { CellOutputPayload, ClientMessage } from '../types'
import type { IRunner } from './runner'
import { ClientMessages, OutputType } from '../constants'
import { API } from '../utils/deno/api'

import executor, { runme } from './executors'
import { ExperimentalTerminal } from './terminal/terminal'
import { ENV_STORE, DENO_ACCESS_TOKEN_KEY, PLATFORM_OS } from './constants'
import { resetEnv, getKey, getAnnotations, hashDocumentUri, getCmdShellSeq } from './utils'

import './wasm/wasm_exec.js'
import { closeTerminalByEnvID } from './executors/task'

enum ConfirmationItems {
  Yes = 'Yes',
  No = 'No',
  Skip = 'Skip Prompt and run all',
  Cancel = 'Cancel'
}

export class Kernel implements Disposable {
  static readonly type = 'runme' as const

  readonly #experiments = new Map<string, boolean>()

  #terminals = new Map<string, ExperimentalTerminal>
  #disposables: Disposable[] = []
  #controller = notebooks.createNotebookController(
    Kernel.type,
    Kernel.type,
    Kernel.type.toUpperCase()
  )
  protected messaging = notebooks.createRendererMessaging('runme-renderer')

  constructor(
    protected context: ExtensionContext,
    protected runner?: IRunner
  ) {
    const config = workspace.getConfiguration('runme.experiments')
    this.#experiments.set('pseudoterminal', config.get<boolean>('pseudoterminal', false))
    this.#experiments.set('grpcSerializer', config.get<boolean>('grpcSerializer', false))

    this.#controller.supportedLanguages = Object.keys(executor)
    this.#controller.supportsExecutionOrder = false
    this.#controller.description = 'Run your README.md'
    this.#controller.executeHandler = this._executeAll.bind(this)

    this.messaging.postMessage({ from: 'kernel' })
    this.#disposables.push(
      this.messaging.onDidReceiveMessage(this.#handleRendererMessage.bind(this)),
      window.onDidChangeActiveNotebookEditor(this.#handleRunmeTerminals.bind(this)),
      workspace.onDidOpenNotebookDocument(this.#handleOpenNotebook.bind(this)),
      workspace.onDidSaveNotebookDocument(this.#handleSaveNotebook.bind(this))
    )
  }

  hasExperimentEnabled(key: string, defaultValue?: boolean) {
    return this.#experiments.get(key) || defaultValue
  }

  dispose () {
    resetEnv()
    this.#controller.dispose()
    this.#disposables.forEach((d) => d.dispose())
  }

  async #handleSaveNotebook({ uri, isUntitled, notebookType }: NotebookDocument) {
    if (notebookType !== Kernel.type) {
      return
    }
    const isReadme = uri.fsPath.toUpperCase().includes('README')
    const hashed = hashDocumentUri(uri.toString())
    TelemetryReporter.sendTelemetryEvent('notebook.save', {
      'notebook.hashedUri': hashed,
      'notebook.isReadme': isReadme.toString(),
      'notebook.isUntitled': isUntitled.toString(),
    })
  }


  async #handleOpenNotebook({ uri, isUntitled, notebookType }: NotebookDocument) {
    if (notebookType !== Kernel.type) {
      return
    }
    const isReadme = uri.fsPath.toUpperCase().includes('README')
    const hashed = hashDocumentUri(uri.toString())
    TelemetryReporter.sendTelemetryEvent('notebook.open', {
      'notebook.hashedUri': hashed,
      'notebook.isReadme': isReadme.toString(),
      'notebook.isUntitled': isUntitled.toString(),
    })
  }

  // eslint-disable-next-line max-len
  async #handleRendererMessage({ editor, message }: { editor: NotebookEditor, message: ClientMessage<ClientMessages> }) {
    if (message.type === ClientMessages.mutateAnnotations) {
      const payload = message as ClientMessage<ClientMessages.mutateAnnotations>

      let editCell: NotebookCell | undefined = undefined
      for (const document of workspace.notebookDocuments) {
        for (const cell of document.getCells()) {
          if (cell.document.uri.fsPath !== editor.notebook.uri.fsPath) {
            break
          }

          if (cell.metadata?.['runme.dev/uuid'] === payload.output.annotations['runme.dev/uuid']) {
            editCell = cell
            break
          }
        }

        if (editCell) {
          break
        }
		}

      if (editCell) {
        const edit = new WorkspaceEdit()
        const newMetadata = {
          ...editCell.metadata,
          ...payload.output.annotations,
        }
        const notebookEdit = NotebookEdit.updateCellMetadata(editCell.index, newMetadata)

        edit.set(editCell.notebook.uri, [notebookEdit])
        await workspace.applyEdit(edit)
      }

      return
    } else if (message.type === ClientMessages.promote) {
      const payload = message as ClientMessage<ClientMessages.promote>
      const token = ENV_STORE.get(DENO_ACCESS_TOKEN_KEY)
      if (!token) {
        return
      }

      const api = API.fromToken(token)
      const deployed = await api.promoteDeployment(payload.output.id, payload.output.productionDeployment)
      this.messaging.postMessage(<ClientMessage<ClientMessages.deployed>>{
        type: ClientMessages.deployed,
        output: deployed
      })
    } else if (message.type === ClientMessages.prod) {
      const payload = message as ClientMessage<ClientMessages.prod>
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const cell = editor.notebook.cellAt(payload.output.cellIndex)
      if (cell.executionSummary?.success) {
        process.env['vercelProd'] = 'true'
        return this._doExecuteCell(cell)
      }
    } else if (message.type === ClientMessages.infoMessage) {
      return window.showInformationMessage(message.output as string)
    } else if (message.type === ClientMessages.errorMessage) {
      return window.showInformationMessage(message.output as string)
    }

    console.error(`[Runme] Unknown kernel event type: ${message.type}`)
  }

  private async _executeAll(cells: NotebookCell[]) {
    const totalNotebookCells = (
      cells[0] &&
      cells[0].notebook.getCells().filter((cell) => cell.kind === NotebookCellKind.Code).length
    ) || 0
    const totalCellsToExecute = cells.length
    let showConfirmPrompt = totalNotebookCells === totalCellsToExecute && totalNotebookCells > 1
    let cellsExecuted = 0

    for (const cell of cells) {
      if (showConfirmPrompt) {
        const annotations = getAnnotations(cell)
        const cellText = cell.document.getText()
        const cellLabel = (
          annotations.name ||
          cellText.length > 20 ? `${cellText.slice(0, 20)}...` : cellText
        )

        const answer = await window.showQuickPick(Object.values(ConfirmationItems), {
          title: `Are you sure you like to run "${cellLabel}"?`,
          ignoreFocusOut: true
        }) as ConfirmationItems | undefined

        if (answer === ConfirmationItems.No) {
          continue
        }

        if (answer === ConfirmationItems.Skip) {
          showConfirmPrompt = false
        }

        if (answer === ConfirmationItems.Cancel) {
          TelemetryReporter.sendTelemetryEvent('cells.executeAll', {
            'cells.total': totalNotebookCells?.toString(),
            'cells.executed': cellsExecuted?.toString(),
          })
          return
        }
      }

      await this._doExecuteCell(cell)
      cellsExecuted++
    }

    TelemetryReporter.sendTelemetryEvent('cells.executeAll', {
      'cells.total': totalNotebookCells?.toString(),
      'cells.executed': cellsExecuted?.toString(),
    })
  }

  public async createCellExecution(cell: NotebookCell): Promise<NotebookCellExecution> {
    return this.#controller.createNotebookCellExecution(cell)
  }

  private async _doExecuteCell(cell: NotebookCell): Promise<void> {
    const runningCell = await workspace.openTextDocument(cell.document.uri)
    const exec = await this.createCellExecution(cell)

    TelemetryReporter.sendTelemetryEvent('cell.startExecute')
    exec.start(Date.now())
    let execKey = getKey(runningCell)

    let successfulCellExecution: boolean

    const hasPsuedoTerminalExperimentEnabled = this.hasExperimentEnabled('pseudoterminal')
    const terminal = this.#terminals.get(cell.document.uri.fsPath)

    if(
      this.runner && 
      !(hasPsuedoTerminalExperimentEnabled && terminal) &&
      (execKey === 'bash' || execKey === 'sh')
    ) {
      // TODO: bring these to top level in new file
      const RUNME_ID = `${runningCell.fileName}:${exec.cell.index}`
      const LABEL_LIMIT = 15

      const cwd = path.dirname(runningCell.uri.fsPath)
      
      successfulCellExecution = await (new Promise(async (resolve) => {
        const runner = this.runner!
        const cellText = exec.cell.document.getText()
        const script = getCmdShellSeq(cellText, PLATFORM_OS)
        
        const program = await runner.createProgramSession()

        const annotations = getAnnotations(exec.cell)

        const { interactive, mimeType, background } = annotations

        if(!interactive) {
          const MIME_TYPES_WITH_CUSTOM_RENDERERS = ['text/plain']
          
          const output: Buffer[] = []

          const mime = mimeType || 'text/plain' as const

          // adapted from `shellExecutor` in `shell.ts`
          // TODO: vercel support
          const handleOutput = (data: Uint8Array) => {
            output.push(Buffer.from(data))

            let item = new NotebookCellOutputItem(Buffer.concat(output), mime)

            // hacky for now, maybe inheritence is a fitting pattern
            if (script.trim().endsWith('vercel')) {
              // TODO: vercel (see `shellExecutor`)
            } else if (MIME_TYPES_WITH_CUSTOM_RENDERERS.includes(mime)) {
              item = NotebookCellOutputItem.json(<CellOutputPayload<OutputType.outputItems>>{
                type: OutputType.outputItems,
                output: {
                  content: Buffer.concat(output).toString('base64'),
                  mime
                }
              }, OutputType.outputItems)
            }
            
            exec.replaceOutput([ new NotebookCellOutput([ item ]) ])
          }
          
          program.onStdoutRaw(handleOutput)
          program.onStderrRaw(handleOutput)

          exec.token.onCancellationRequested(() => {
            program.close()
          })
        } else {
          const taskExecution = new Task(
            { type: 'shell', name: `Runme Task (${RUNME_ID})` },
            TaskScope.Workspace,
            cellText.length > LABEL_LIMIT
              ? `${cellText.slice(0, LABEL_LIMIT)}...`
              : cellText,
            'exec',
            new CustomExecution(async () => program)
          )

          taskExecution.isBackground = background
          taskExecution.presentationOptions = {
            focus: true,
            reveal: background ? TaskRevealKind.Never : TaskRevealKind.Always,
            panel: background ? TaskPanelKind.Dedicated : TaskPanelKind.Shared
          }

          const execution = await tasks.executeTask(taskExecution)

          exec.token.onCancellationRequested(() => {
            try {
              // runs `program.close()` implicitly
              execution.terminate()
              closeTerminalByEnvID(RUNME_ID)
            } catch (err: any) {
              console.error(`[Runme] Failed to terminate task: ${(err as Error).message}`)
              resolve(false)
            }
          })

          tasks.onDidEndTaskProcess((e) => {
            const taskId = (e.execution as any)['_id']
            const executionId = (execution as any)['_id']
      
            /**
             * ignore if
             */
            if (
              /**
               * VS Code is running a different task
               */
              taskId !== executionId ||
              /**
               * we don't have an exit code
               */
              typeof e.exitCode === 'undefined') {
              return
            }
      
            /**
             * only close terminal if execution passed and desired by user
             */
            if (e.exitCode === 0 && annotations.closeTerminalOnSuccess) {
              closeTerminalByEnvID(RUNME_ID)
            }
      
            return resolve(!!e.exitCode)
          })
        }

        program.onDidClose((code) => {
          if(code) {
            // TODO: do something with this code
            resolve(false)
          }

          resolve(true)
        })

        await program.run({
            // TODO: make this work on windows/if bash isn't installed/etc
            programName: execKey,
            script: {
              type: 'script', script
            },
            envs: [
              `RUNME_ID=${RUNME_ID}`
            ],
            background,
            cwd
        })
      }))
    } else {
      /**
       * check if user is running experiment to execute shell via runme cli
       */
      successfulCellExecution = (hasPsuedoTerminalExperimentEnabled && terminal)
        ? await runme.call(this, exec, terminal)
        : await executor[execKey].call(this, exec, runningCell)
    }

    TelemetryReporter.sendTelemetryEvent('cell.endExecute', { 'cell.success': successfulCellExecution?.toString() })
    exec.end(successfulCellExecution)
  }

  #handleRunmeTerminals (editor?: NotebookEditor) {
    // Todo(Christian): clean up
    if (!editor) {
      return
    }

    /**
     * Runme terminal for notebook already launched
     */
    if (this.#terminals.has(editor.notebook.uri.fsPath)) {
      return
    }

    const runmeTerminal = new ExperimentalTerminal(editor.notebook)
    this.#terminals.set(editor.notebook.uri.fsPath, runmeTerminal)
  }

  setRunner(runner: IRunner|undefined) {
    this.runner = runner
  }
}
