import 'matterviz/app.css'
import './styles.css'
import './ui.css'
import { mount } from 'svelte'
if (new URL(window.location.href).searchParams.get('workbench') === '1') {
  document.title = 'BaneWfn'
  import('./WorkflowPanel.svelte').then(({ default: Panel }) => mount(Panel, { target: document.getElementById('app')! }))
} else {
  import('./App.svelte').then(({ default: App }) => mount(App, { target: document.getElementById('app')! }))
}
