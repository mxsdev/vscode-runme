import { test, expect, vi } from 'vitest'
import { notebooks, workspace, commands } from 'vscode'

import { RunmeExtension } from '../../src/extension/extension'

vi.mock('vscode', async () => {
  const mocked = await vi.importMock('vscode')
  return ({
    ...(mocked as object),
    default: mocked
  })
})

test('initializes all providers', async () => {
  const context: any = { subscriptions: [], extensionUri: { fsPath: '/foo/bar' } }
  const ext = new RunmeExtension()
  await ext.initialize(context)
  expect(notebooks.registerNotebookCellStatusBarItemProvider).toBeCalledTimes(5)
  expect(workspace.registerNotebookSerializer).toBeCalledTimes(1)
  expect(commands.registerCommand).toBeCalledTimes(8)
})
