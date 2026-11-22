import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export type PlayerOptions = {
  /** Directory holding the .cast files; the player is written alongside them. */
  out: string
  /** Screens to show, in order, by name (`<name>.cast`). Defaults to every cast in `out`. */
  screens?: readonly string[]
  /** Page title. */
  title?: string
  /**
   * The path the page is served under, when that differs from where its files
   * sit — e.g. `/projects/tidepool/demo/` when a site rewrites that path to
   * this deployment. Becomes the page's `<base href>`; omit when served as is.
   */
  base?: string
}

// Shipped in the package next to dist/, so the same relative path holds from
// src/ under the tests and from dist/ once built.
const PLAYER = fileURLToPath(new URL("../player/", import.meta.url))

const ASSETS = ["player.js", "chrome.css"]
const FONT_FILES = ["SymbolsNerdFontMono-Regular.woff2", "LICENSE", "README.md"]

// The browser build of the emulator that resolved the capture, so the page
// replays with the same parser rather than a second implementation of it.
const xterm = (file: string): string =>
  createRequire(import.meta.url).resolve(`@xterm/xterm/${file}`)

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

// Inline so the controls draw before any stylesheet or font has arrived.
const ICONS = {
  play: '<svg class="icon-play" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.8v10.4L13 8z"/></svg>',
  pause:
    '<svg class="icon-pause" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z"/></svg>',
  restart:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5a5.5 5.5 0 1 1-5.2 3.7l1.4.5A4 4 0 1 0 8 4v2L4.8 3.2 8 .5z"/></svg>',
}

// The bar reads as the shell's own title: the command, then the shell.
const screenMarkup = (command: string, screen: string): string => {
  const name = escapeHtml(screen)
  const label = escapeHtml(`${command} ${screen}`)
  const cast = escapeHtml(encodeURIComponent(`${screen}.cast`))
  return [
    `      <figure class="window" data-cast="${cast}" aria-label="Terminal recording: ${label}">`,
    `        <div class="window-bar" aria-hidden="true">`,
    `          <span class="window-dots"><i></i><i></i><i></i></span>`,
    `          <span class="window-title">${label} — zsh</span>`,
    `        </div>`,
    `        <div class="window-screen"><div class="window-term"></div></div>`,
    `        <div class="window-controls" role="group" aria-label="Playback: ${name}">`,
    `          <button type="button" class="control" data-action="toggle" aria-label="Play">${ICONS.play}${ICONS.pause}</button>`,
    `          <button type="button" class="control" data-action="restart" aria-label="Restart">${ICONS.restart}</button>`,
    `          <button type="button" class="control control-speed" data-action="speed" aria-label="Playback speed 1×, switch to 2×">1×</button>`,
    `        </div>`,
    `      </figure>`,
  ].join("\n")
}

// A static folder Vercel serves as it stands: no framework, no build step.
// Recordings and assets are cached briefly rather than immutably, because
// their names do not change when a re-run rewrites them.
export const VERCEL_CONFIG = {
  $schema: "https://openapi.vercel.sh/vercel.json",
  framework: null,
  buildCommand: null,
  installCommand: null,
  trailingSlash: true,
  headers: [
    {
      source: "/(.*).cast",
      headers: [
        { key: "Content-Type", value: "application/x-asciicast; charset=utf-8" },
        { key: "Cache-Control", value: "public, max-age=300" },
      ],
    },
    {
      source: "/assets/(.*)",
      headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
    },
  ],
}

const castsIn = (out: string): string[] =>
  readdirSync(out)
    .filter((file) => file.endsWith(".cast"))
    .sort()
    .map((file) => basename(file, ".cast"))

/**
 * Write a static replay page for the casts in `out`: `index.html`, its assets
 * (player, chrome, xterm.js, the Symbols Nerd Font) and a `vercel.json`. The
 * folder deploys as it stands. Returns the paths written.
 */
export const buildPlayer = ({
  out,
  screens = castsIn(out),
  title = "Terminal demo",
  base,
}: PlayerOptions): string[] => {
  if (screens.length === 0) {
    throw new Error(`No recordings to play: ${out} holds no .cast files.`)
  }

  const assets = join(out, "assets")
  mkdirSync(join(assets, "fonts"), { recursive: true })
  const written: string[] = []
  const copy = (from: string, to: string) => {
    copyFileSync(from, to)
    written.push(to)
  }

  for (const file of ASSETS) copy(join(PLAYER, file), join(assets, file))
  for (const file of FONT_FILES) {
    copy(join(PLAYER, "fonts", file), join(assets, "fonts", file))
  }
  copy(xterm("lib/xterm.mjs"), join(assets, "xterm.mjs"))
  copy(xterm("css/xterm.css"), join(assets, "xterm.css"))
  copy(
    join(dirname(xterm("package.json")), "LICENSE"),
    join(assets, "xterm.LICENSE"),
  )

  // Split and joined rather than replaced, so a `$&` in a title is just text.
  const fill = (template: string, values: Record<string, string>) =>
    Object.entries(values).reduce(
      (html, [key, value]) => html.split(`{{${key}}}`).join(value),
      template,
    )
  const html = fill(readFileSync(join(PLAYER, "index.html"), "utf8"), {
    title: escapeHtml(title),
    base: base ? `<base href="${escapeHtml(base)}" />` : "",
    screens: screens.map((screen) => screenMarkup(title, screen)).join("\n"),
  })
  const index = join(out, "index.html")
  writeFileSync(index, html)
  written.push(index)

  const vercel = join(out, "vercel.json")
  writeFileSync(vercel, JSON.stringify(VERCEL_CONFIG, null, 2) + "\n")
  written.push(vercel)

  return written
}
