/* Preferência visual deste navegador; aplicada antes da primeira pintura. */
let currentColorTheme='dark';
function themeColor(role) {
  const light=currentColorTheme==='light';
  return role==='grid'?(light?'rgba(40,40,70,.10)':'rgba(255,255,255,.06)')
    : role==='label'?(light?'#43435d':'rgba(200,200,220,.85)')
    : (light?'#64647c':'#9999aa');
}
function updateThemeControls() {
  document.querySelectorAll('[data-theme-toggle]').forEach(button=>{
    button.textContent=currentColorTheme==='light'?'Modo escuro':'Modo claro';
    button.setAttribute('aria-label','Ativar '+(currentColorTheme==='light'?'modo escuro':'modo claro'));
    button.setAttribute('aria-pressed',String(currentColorTheme==='light'));
  });
}
function setColorTheme(value,persist=true) {
  currentColorTheme=value==='light'?'light':'dark';
  document.documentElement.dataset.theme=currentColorTheme;
  document.documentElement.style.colorScheme=currentColorTheme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',currentColorTheme==='light'?'#f5f5fa':'#6c63ff');
  if(persist){try{localStorage.setItem('cp_color_theme',currentColorTheme);}catch{/* A aparência continua funcionando sem persistência. */}}
  updateThemeControls();
}
function toggleColorTheme() {
  setColorTheme(currentColorTheme==='light'?'dark':'light');
  if(typeof render==='function')render();
}
try{setColorTheme(localStorage.getItem('cp_color_theme'),false);}catch{setColorTheme('dark',false);}
document.addEventListener('DOMContentLoaded',updateThemeControls);
