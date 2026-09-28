/**
 * Installs the subset of Obsidian's global DOM helpers (`createEl`, `createDiv`,
 * `createSpan`) that the plugin and its tests call, so they run under jsdom.
 * It supports the `cls`, `text` and `attr` options only. Outside a DOM
 * environment it does nothing.
 */

interface ElementOptions {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string | number | boolean | null>;
}

const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

function install(target: Window): void {
  const build = (tag: string, options?: ElementOptions | string): HTMLElement => {
    // An element in the XHTML namespace is an HTMLElement, the same as the helpers answer in Obsidian.
    const element = target.document.createElementNS(XHTML_NAMESPACE, tag);
    const info: ElementOptions = typeof options === "string" ? { cls: options } : (options ?? {});
    if (info.cls !== undefined) element.className = Array.isArray(info.cls) ? info.cls.join(" ") : info.cls;
    if (info.text !== undefined) element.textContent = info.text;
    for (const [name, value] of Object.entries(info.attr ?? {})) {
      if (value !== null && value !== false) element.setAttribute(name, String(value));
    }
    return element;
  };
  Object.defineProperty(target, "createEl", { value: build, configurable: true });
  Object.defineProperty(target, "createDiv", { value: (options?: ElementOptions | string) => build("div", options), configurable: true });
  Object.defineProperty(target, "createSpan", { value: (options?: ElementOptions | string) => build("span", options), configurable: true });
}

if (typeof window !== "undefined") install(window);
