// Keep per-model resources bounded, recover from a bad file, and preserve
// completed outputs when the user stops a batch.
export async function runBatch<Item, Model, Output>(
  items: Item[], signal: AbortSignal,
  actions: {
    open: (item: Item) => Promise<Model>;
    render: (model: Model, progress: (value: number) => void) => Promise<Output>;
    dispose: (model: Model) => void;
    started: (item: Item) => void;
    progress: (item: Item, value: number, index: number) => void;
    finished: (item: Item, output: Output) => void;
    failed: (item: Item, error: unknown, cancelled: boolean) => void;
  },
) {
  for (let index = 0; index < items.length; index++) {
    signal.throwIfAborted();
    const item = items[index];
    let model: Model | undefined;
    actions.started(item);
    try {
      model = await actions.open(item);
      signal.throwIfAborted();
      const output = await actions.render(model, (value) => actions.progress(item, value, index));
      signal.throwIfAborted();
      actions.finished(item, output);
    } catch (error) {
      actions.failed(item, error, signal.aborted);
      if (signal.aborted) throw error;
    } finally { if (model !== undefined) actions.dispose(model); }
  }
}
