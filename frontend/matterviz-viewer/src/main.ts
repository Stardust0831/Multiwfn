import 'matterviz/app.css'
import './styles.css'
import './ui.css'
import { mount } from 'svelte'
import App from './App.svelte'

mount(App, { target: document.getElementById('app')! })
