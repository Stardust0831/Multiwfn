import { read_frequency_cjson, FREQUENCY_FILE_LIMIT, type FrequencyData } from './frequency'

export type FrequencyFile = Pick<File, 'name' | 'size' | 'text'>
export interface FrequencyQueueState {
  files: readonly FrequencyFile[]
  index: number
  data?: FrequencyData
  displayedName: string
  error: string
  loading: boolean
}

/** Only the selected file is decoded. Every navigation/replacement/close retires old reads. */
export function create_frequency_queue(onchange: (state: FrequencyQueueState) => void = () => {}) {
  let state: FrequencyQueueState = { files: [], index: -1, displayedName: '', error: '', loading: false }
  let generation = 0
  let disposed = false
  const publish = (change: Partial<FrequencyQueueState>) => {
    state = { ...state, ...change }
    onchange(state)
  }
  async function select(index: number): Promise<void> {
    if (disposed || !Number.isInteger(index) || !state.files[index]) return
    const current = ++generation
    const file = state.files[index]
    publish({ index, error: '', loading: true })
    try {
      if (file.size > FREQUENCY_FILE_LIMIT) throw new Error('Frequency file exceeds the 16 MiB limit.')
      const text = await file.text()
      if (disposed || current !== generation) return
      const data = read_frequency_cjson(text)
      publish({ data, displayedName: file.name })
    } catch (reason) {
      if (!disposed && current === generation) publish({ error: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      if (!disposed && current === generation) publish({ loading: false })
    }
  }
  return {
    get state() { return state },
    async replace(files: readonly FrequencyFile[]): Promise<void> {
      if (disposed || !files.length) return
      generation++
      publish({ files: [...files], index: 0 })
      await select(0)
    },
    select,
    dispose() { disposed = true; generation++ },
  }
}
