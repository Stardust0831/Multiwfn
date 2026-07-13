export type ReturnLifecycle = {
  request: () => Promise<void>
  close: () => void
  onReturned: () => void
  onError: (error: unknown) => void
}

/** Request Return, then close the current client just like the original GUI. */
export const request_return_and_close = async (lifecycle: ReturnLifecycle): Promise<void> => {
  try {
    await lifecycle.request()
    lifecycle.onReturned()
  } catch (error) {
    lifecycle.onError(error)
  } finally {
    try {
      lifecycle.close()
    } catch (error) {
      lifecycle.onError(error)
    }
  }
}
