import { BorderedLoader } from "@earendil-works/pi-coding-agent";

export interface BusyCommandContext {
  hasUI: boolean;
  mode?: string;
  ui: {
    custom?: <T>(
      factory: (
        tui: unknown,
        theme: unknown,
        keybindings: unknown,
        done: (result: T) => void,
      ) => unknown,
    ) => Promise<T>;
  };
}

/**
 * Run a short user-triggered command while the TUI editor is temporarily
 * replaced by a non-cancellable loader. Headless/RPC modes execute directly.
 *
 * The operation starts in a microtask after the loader factory returns, so the
 * loader gets a chance to mount and render before slow IO begins.
 */
export async function withBusyCommand<T>(
  ctx: BusyCommandContext,
  message: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (ctx.mode !== "tui" || typeof ctx.ui.custom !== "function") {
    return await operation();
  }

  const outcome = await ctx.ui.custom<{ ok: true; value: T } | { ok: false; error: unknown }>(
    (tui, theme, _keybindings, done) => {
      const safeTui = {
        requestRender: () => {
          try {
            (tui as { requestRender?: () => void }).requestRender?.();
          } catch {
            // Rendering is best-effort; command completion still releases UI.
          }
        },
      };
      const loader = new BorderedLoader(safeTui as never, theme as never, message, {
        cancellable: false,
      });

      void Promise.resolve().then(async () => {
        try {
          done({ ok: true, value: await operation() });
        } catch (error) {
          done({ ok: false, error });
        }
      });

      return loader;
    },
  );

  if (outcome.ok) return outcome.value;
  throw outcome.error;
}
