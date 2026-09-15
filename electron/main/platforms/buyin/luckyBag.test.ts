import { describe, expect, it, vi } from 'vitest'
import { performStartFirstPendingLuckyBag } from './luckyBag'

function createStartButton(enabled = true) {
  const button = {
    isEnabled: vi.fn().mockResolvedValue(enabled),
    click: vi.fn().mockResolvedValue(undefined),
    waitFor: vi.fn().mockResolvedValue(undefined),
  }
  const handle = {
    click: button.click,
    waitForElementState: button.waitFor,
    dispose: vi.fn().mockResolvedValue(undefined),
  }
  return { ...button, handle, elementHandles: vi.fn().mockResolvedValue([handle]) }
}

function createLuckyBagPage(
  buttons: ReturnType<typeof createStartButton>[],
  options: { missingPendingTab?: boolean } = {},
) {
  const entry = {
    isVisible: vi.fn().mockResolvedValue(true),
    isEnabled: vi.fn().mockResolvedValue(true),
    click: vi.fn().mockResolvedValue(undefined),
  }
  const pendingTab = {
    waitFor: options.missingPendingTab
      ? vi.fn().mockRejectedValue(new Error('pending tab missing'))
      : vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
  }
  const closeButton = {
    isVisible: vi.fn().mockResolvedValue(true),
    click: vi.fn().mockResolvedValue(undefined),
  }
  const readyState = { waitFor: vi.fn().mockResolvedValue(undefined) }
  const loading = { waitFor: vi.fn().mockResolvedValue(undefined) }
  const startButtons = {
    all: vi.fn().mockResolvedValue(buttons),
    or: vi.fn().mockReturnValue({ first: () => readyState }),
  }
  const pendingPanel = {
    waitFor: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn().mockReturnValue({ first: () => loading }),
    getByText: vi.fn().mockReturnValue({}),
    getByRole: vi.fn().mockReturnValue(startButtons),
  }
  const manager = {
    waitFor: vi.fn().mockResolvedValue(undefined),
    getByRole: vi.fn((role: string, selector: { name: string; exact?: boolean }) => {
      if (role === 'tab' && selector.name === '待开始') return pendingTab
      if (role === 'button' && selector.name === '开始活动' && selector.exact) {
        return startButtons
      }
      throw new Error(`Unexpected manager selector: ${role}/${selector.name}`)
    }),
    locator: vi.fn((selector: string) => {
      if (selector === '[aria-label="关闭"]' || selector === 'button.buyin-drawer-close') {
        return { first: () => closeButton }
      }
      if (
        selector === ':scope[aria-busy="true"], [aria-busy="true"], [role="progressbar"]:visible'
      ) {
        return { first: () => loading }
      }
      throw new Error(`Unexpected selector: ${selector}`)
    }),
    getByText: vi.fn((text: string | RegExp) => {
      if (text === '待开始') return { first: () => pendingTab }
      if (text instanceof RegExp) return pendingPanel.getByText(text)
      throw new Error(`Unexpected manager text: ${text}`)
    }),
  }
  return {
    entry,
    pendingTab,
    closeButton,
    manager,
    pendingPanel,
    readyState,
    loading,
    startButtons,
    getByText: vi.fn((text: string) => {
      if (text !== '超级福袋') throw new Error(`Unexpected entry: ${text}`)
      return { all: vi.fn().mockResolvedValue([entry]) }
    }),
    getByRole: vi.fn((role: string) => {
      if (role !== 'dialog') throw new Error(`Unexpected role: ${role}`)
      return {
        filter: vi.fn((filter: { hasText: string }) => {
          if (filter.hasText !== '管理超级福袋活动') throw new Error('Unexpected manager')
          return { first: () => manager }
        }),
      }
    }),
    locator: vi.fn((selector: string) => {
      if (selector !== '.buyin-drawer.buyin-drawer-open') {
        throw new Error(`Unexpected page selector: ${selector}`)
      }
      return { first: () => manager }
    }),
    keyboard: { press: vi.fn().mockResolvedValue(undefined) },
  }
}

describe('performStartFirstPendingLuckyBag', () => {
  it('supports the div-based open drawer shown by the Buyin page', async () => {
    const button = createStartButton()
    const page = createLuckyBagPage([button])
    page.getByRole.mockImplementation(() => {
      throw new Error('the Buyin drawer has no dialog role')
    })

    expect(await performStartFirstPendingLuckyBag(page as never)).toMatchObject({
      value: 'started',
    })
    expect(page.locator).toHaveBeenCalledWith('.buyin-drawer.buyin-drawer-open')
    expect(button.click).toHaveBeenCalledOnce()
  })

  it('closes the manager when the entry opens it and then throws', async () => {
    const page = createLuckyBagPage([])
    let open = false
    page.entry.click.mockImplementation(async () => {
      open = true
      throw new Error('entry click failed after opening')
    })
    page.closeButton.click.mockImplementation(async () => {
      open = false
    })
    expect(await performStartFirstPendingLuckyBag(page as never)).toMatchObject({ type: 'Failure' })
    expect(page.closeButton.click).toHaveBeenCalledOnce()
    expect(open).toBe(false)
  })

  it('waits for pending activities to load before taking the button snapshot', async () => {
    const button = createStartButton()
    const page = createLuckyBagPage([])
    page.readyState.waitFor.mockImplementation(async () => {
      await Promise.resolve()
      page.startButtons.all.mockResolvedValue([button])
    })
    expect(await performStartFirstPendingLuckyBag(page as never)).toMatchObject({
      value: 'started',
    })
    expect(button.click).toHaveBeenCalledOnce()
    expect(page.readyState.waitFor.mock.invocationCallOrder[0]).toBeLessThan(
      page.startButtons.all.mock.invocationCallOrder[0],
    )
  })

  it('fails instead of reporting empty when neither activities nor an empty state load', async () => {
    const page = createLuckyBagPage([])
    page.readyState.waitFor.mockRejectedValue(new Error('list readiness timed out'))
    expect(await performStartFirstPendingLuckyBag(page as never)).toMatchObject({ type: 'Failure' })
    expect(page.startButtons.all).not.toHaveBeenCalled()
    expect(page.closeButton.click).toHaveBeenCalledOnce()
  })

  it('waits for loading to finish even when a stale empty state is visible', async () => {
    const button = createStartButton()
    const page = createLuckyBagPage([])
    page.loading.waitFor.mockImplementation(async () => {
      page.startButtons.all.mockResolvedValue([button])
    })
    expect(await performStartFirstPendingLuckyBag(page as never)).toMatchObject({
      value: 'started',
    })
    expect(page.loading.waitFor).toHaveBeenCalledWith({
      state: 'hidden',
      timeout: 5000,
      signal: undefined,
    })
  })

  it('confirms removal of A even when the dynamic locator now resolves to B', async () => {
    const first = createStartButton()
    const second = createStartButton()
    const rows = [first, second]
    const dynamicFirst = {
      ...first,
      waitFor: vi.fn(async () => {
        if (rows[0]) throw new Error('nth(0) now resolves to the remaining B')
      }),
    }
    first.click.mockImplementation(async () => {
      rows.shift()
    })
    const page = createLuckyBagPage([dynamicFirst, second])
    expect(await performStartFirstPendingLuckyBag(page as never)).toMatchObject({
      value: 'started',
    })
    expect(rows).toEqual([second])
    expect(second.click).not.toHaveBeenCalled()
    expect(first.handle.dispose).toHaveBeenCalledOnce()
  })

  it('cancels a waiting click before the button becomes actionable', async () => {
    const button = createStartButton()
    const page = createLuckyBagPage([button])
    const controller = new AbortController()
    let started = false
    button.click.mockImplementation(async (options?: { signal?: AbortSignal }) => {
      const cancelled = new Promise<void>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        })
      })
      controller.abort()
      await Promise.race([cancelled, Promise.resolve()])
      started = true
    })
    expect(await performStartFirstPendingLuckyBag(page as never, controller.signal)).toMatchObject({
      type: 'Failure',
    })
    expect(started).toBe(false)
    expect(page.closeButton.click).toHaveBeenCalledOnce()
  })

  it('bounds enabled checks and passes the cancellation signal to waiting actions', async () => {
    const button = createStartButton()
    const page = createLuckyBagPage([button])
    const controller = new AbortController()
    await performStartFirstPendingLuckyBag(page as never, controller.signal)
    const options = { timeout: 5000, signal: controller.signal }
    expect(page.entry.isEnabled).toHaveBeenCalledWith(options)
    expect(button.isEnabled).toHaveBeenCalledWith(options)
    expect(page.entry.click).toHaveBeenCalledWith(options)
    expect(page.pendingTab.click).toHaveBeenCalledWith(options)
    expect(button.click).toHaveBeenCalledWith(options)
    expect(page.manager.waitFor).toHaveBeenCalledWith({ ...options, state: 'visible' })
    expect(page.closeButton.click).toHaveBeenCalledWith({ timeout: 5000 })
  })

  it('clicks the first enabled 开始活动 button', async () => {
    const first = createStartButton()
    const second = createStartButton()
    const page = createLuckyBagPage([first, second])
    const result = await performStartFirstPendingLuckyBag(page as never)
    expect(result).toEqual({ type: 'Success', value: 'started' })
    expect(first.click).toHaveBeenCalledOnce()
    expect(second.click).not.toHaveBeenCalled()
    expect(page.closeButton.click).toHaveBeenCalledOnce()
  })

  it('returns no-pending-activity when no start button exists', async () => {
    const page = createLuckyBagPage([])
    const result = await performStartFirstPendingLuckyBag(page as never)
    expect(result).toEqual({ type: 'Success', value: 'no-pending-activity' })
    expect(page.closeButton.click).toHaveBeenCalledOnce()
  })

  it('closes the manager when the pending tab is missing', async () => {
    const page = createLuckyBagPage([], { missingPendingTab: true })
    const result = await performStartFirstPendingLuckyBag(page as never)
    expect(result).toMatchObject({ type: 'Failure', error: { name: 'ElementNotFoundError' } })
    expect(page.closeButton.click).toHaveBeenCalledOnce()
  })

  it('skips disabled start buttons', async () => {
    const disabled = createStartButton(false)
    const enabled = createStartButton()
    const page = createLuckyBagPage([disabled, enabled])
    expect(await performStartFirstPendingLuckyBag(page as never)).toMatchObject({
      value: 'started',
    })
    expect(disabled.click).not.toHaveBeenCalled()
    expect(enabled.click).toHaveBeenCalledOnce()
  })

  it('uses Escape when the close button is missing', async () => {
    const page = createLuckyBagPage([])
    page.closeButton.isVisible.mockResolvedValue(false)
    expect(await performStartFirstPendingLuckyBag(page as never)).toMatchObject({
      value: 'no-pending-activity',
    })
    expect(page.keyboard.press).toHaveBeenCalledWith('Escape')
    expect(page.closeButton.click).not.toHaveBeenCalled()
  })

  it('uses Escape when clicking the close button fails', async () => {
    const page = createLuckyBagPage([])
    page.closeButton.click.mockRejectedValue(new Error('close failed'))
    expect(await performStartFirstPendingLuckyBag(page as never)).toMatchObject({
      value: 'no-pending-activity',
    })
    expect(page.keyboard.press).toHaveBeenCalledWith('Escape')
  })

  it('uses the Buyin drawer close button class shown by the page DOM', async () => {
    const page = createLuckyBagPage([])
    await performStartFirstPendingLuckyBag(page as never)
    expect(page.manager.locator).toHaveBeenCalledWith('button.buyin-drawer-close')
  })

  it('does not click a disabled entry', async () => {
    const page = createLuckyBagPage([])
    page.entry.isEnabled.mockResolvedValue(false)
    expect(await performStartFirstPendingLuckyBag(page as never)).toMatchObject({
      type: 'Failure',
      error: { name: 'ElementNotFoundError' },
    })
    expect(page.entry.click).not.toHaveBeenCalled()
  })

  it('stops before opening the manager when already aborted', async () => {
    const page = createLuckyBagPage([])
    const controller = new AbortController()
    controller.abort()
    expect(await performStartFirstPendingLuckyBag(page as never, controller.signal)).toMatchObject({
      type: 'Failure',
    })
    expect(page.entry.click).not.toHaveBeenCalled()
  })

  it('closes the manager and does not start an activity when aborted after opening', async () => {
    const button = createStartButton()
    const page = createLuckyBagPage([button])
    const controller = new AbortController()
    page.pendingTab.click.mockImplementation(async () => controller.abort())
    expect(await performStartFirstPendingLuckyBag(page as never, controller.signal)).toMatchObject({
      type: 'Failure',
    })
    expect(button.click).not.toHaveBeenCalled()
    expect(page.closeButton.click).toHaveBeenCalledOnce()
  })

  it('treats a successful click as started without waiting for the button to disappear', async () => {
    const button = createStartButton()
    button.waitFor.mockRejectedValue(new Error('button remains visible'))
    const page = createLuckyBagPage([button])
    expect(await performStartFirstPendingLuckyBag(page as never)).toMatchObject({
      value: 'started',
    })
    expect(button.waitFor).not.toHaveBeenCalled()
    expect(page.closeButton.click).toHaveBeenCalledOnce()
  })
})
