import { Result } from '@praha/byethrow'
import type { Locator, Page } from 'playwright'
import { UnexpectedError } from '../../errors/AppError'
import { ElementNotFoundError, type PlatformError } from '../../errors/PlatformError'
import type { LuckyBagRunResult } from '../IPlatform'

const ACTION_TIMEOUT = 5000

export async function performStartFirstPendingLuckyBag(
  page: Page,
  signal?: AbortSignal,
): Result.ResultAsync<LuckyBagRunResult, PlatformError> {
  return Result.try({
    immediate: true,
    try: async () => {
      const actionOptions = { timeout: ACTION_TIMEOUT, signal }
      const act = async <T>(action: () => Promise<T>): Promise<T> => {
        signal?.throwIfAborted()
        return action()
      }
      const waitForVisible = async (locator: Locator, elementName: string) => {
        signal?.throwIfAborted()
        try {
          await locator.waitFor({ ...actionOptions, state: 'visible' })
        } catch (cause) {
          throw new ElementNotFoundError({ elementName, cause })
        }
      }
      signal?.throwIfAborted()
      const entries = await page.getByText('超级福袋', { exact: true }).all()
      let entry: Locator | undefined
      for (const candidate of entries) {
        if (!(await act(() => candidate.isVisible()))) continue
        if (!(await act(() => candidate.isEnabled(actionOptions)))) continue
        entry = candidate
        break
      }
      if (!entry) throw new ElementNotFoundError({ elementName: '可用的超级福袋入口' })
      // 百应的福袋管理器是普通抽屉 div，没有 dialog/tab/tabpanel ARIA 语义。
      const manager = page.locator('.buyin-drawer.buyin-drawer-open').first()
      try {
        await act(() => entry.click(actionOptions))
        await waitForVisible(manager, '管理超级福袋活动弹窗')
        const pendingTab = manager.getByText('待开始', { exact: true }).first()
        await waitForVisible(pendingTab, '待开始页签')
        await act(() => pendingTab.click(actionOptions))
        const loading = manager
          .locator(':scope[aria-busy="true"], [aria-busy="true"], [role="progressbar"]:visible')
          .first()
        await act(() => loading.waitFor({ ...actionOptions, state: 'hidden' }))
        const startButtons = manager.getByRole('button', { name: '开始活动', exact: true })
        // 必须出现活动或明确空态；切页后的短暂无按钮不能视为已加载的空列表。
        const emptyState = manager.getByText(/^(暂无待开始活动|暂无活动|暂无数据)$/)
        await waitForVisible(startButtons.or(emptyState).first(), '待开始活动或已加载的空状态')
        await act(() => loading.waitFor({ ...actionOptions, state: 'hidden' }))
        const buttons = await act(() => startButtons.all())
        for (const button of buttons) {
          if (!(await act(() => button.isEnabled(actionOptions)))) continue
          // all() 返回的 nth 定位器会重解析；固定实际点击的节点，避免 A 移除后等待 B 隐藏。
          const [target] = await act(() => button.elementHandles())
          if (!target) throw new ElementNotFoundError({ elementName: '待开始活动按钮' })
          try {
            await act(() => target.click(actionOptions))
          } finally {
            await target.dispose()
          }
          signal?.throwIfAborted()
          return 'started' as const
        }
        signal?.throwIfAborted()
        return 'no-pending-activity' as const
      } finally {
        // 恢复中控台不受取消信号影响，避免取消任务后遗留遮挡页面的弹窗。
        let closed = false
        try {
          const closeButton = manager.locator('button.buyin-drawer-close').first()
          if (await closeButton.isVisible()) {
            await closeButton.click({ timeout: ACTION_TIMEOUT })
            closed = true
          }
        } catch {
          // 关闭控件不可用时使用键盘恢复。
        }
        if (!closed) await page.keyboard.press('Escape')
      }
    },
    catch: error =>
      error instanceof ElementNotFoundError ? error : new UnexpectedError({ cause: error }),
  })
}
