// Pi Web paints a single palette, the dark one. Nothing selects or switches it, so the system
// color scheme and any `pi-theme` value an older version left in storage are both ignored.
// The palette itself lives in `:root` (app/globals.css).
export const THEME_ID = "dark";

// Applied before first paint so the page never flashes a light frame.
export const THEME_INIT_SCRIPT = `(function(){var r=document.documentElement;r.dataset.theme="${THEME_ID}";r.classList.add("dark")})();`;
