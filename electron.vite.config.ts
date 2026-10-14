import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

/**
 * xterm maps mouse → cell with `clientX - rect.left` (scaled by the canvas zoom transform)
 * divided by the unscaled cell size, so selection drifts at any zoom ≠ 100%. Patch that one
 * function to undo the scale. Throws if an xterm upgrade changes the code, so it can't
 * silently regress. (Maestri solves the same thing by reimplementing selection.)
 */
function xtermZoomFix(): Plugin {
  const pattern =
    /(\w+)=(\w+)\.getBoundingClientRect\(\),(\w+)=(\w+)\.getComputedStyle\(\2\),(\w+)=parseInt\(\3\.getPropertyValue\("padding-left"\)\),(\w+)=parseInt\(\3\.getPropertyValue\("padding-top"\)\);return\[(\w+)\.clientX-\1\.left-\5,\7\.clientY-\1\.top-\6\]/
  return {
    name: 'xterm-zoom-fix',
    enforce: 'pre',
    transform(code, id) {
      if (!/@xterm[\/]xterm[\/]lib[\/]xterm\.m?js/.test(id)) return
      if (!pattern.test(code)) throw new Error('xterm-zoom-fix: padrão não encontrado; revisar após atualizar o @xterm/xterm')
      return code.replace(pattern, (_m, r, el, cs, win, pl, pt, ev) =>
        `${r}=${el}.getBoundingClientRect(),${cs}=${win}.getComputedStyle(${el}),${pl}=parseInt(${cs}.getPropertyValue("padding-left")),${pt}=parseInt(${cs}.getPropertyValue("padding-top"));` +
        `return[(${ev}.clientX-${r}.left)/(${el}.offsetWidth?${r}.width/${el}.offsetWidth:1)-${pl},(${ev}.clientY-${r}.top)/(${el}.offsetHeight?${r}.height/${el}.offsetHeight:1)-${pt}]`
      )
    }
  }
}

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    plugins: [xtermZoomFix(), react()],
    // Pre-bundled deps skip plugin transforms in dev; keep xterm out so the fix applies.
    optimizeDeps: { exclude: ['@xterm/xterm'] }
  }
})
