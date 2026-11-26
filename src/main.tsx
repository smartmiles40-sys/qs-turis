import './instrument'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './index.css'
import './styles/ponte.css'
import App from './App.tsx'
import { iniciarAtualizacaoAutomatica } from './lib/versao'
import { instalarTecladoCelular } from './lib/tecladoCelular'
import './natal/natal.css'
import { iniciarNatal } from './natal/natal'

// Deploy novo entra sozinho na aba aberta (ver src/lib/versao.ts).
iniciarAtualizacaoAutomatica()
// Celular: a conversa do WhatsApp acompanha o teclado (só abaixo de 768 px).
instalarTecladoCelular()
// Clima de Natal: liga sozinho de 1/12 a 6/1 (ver src/natal/natal.ts).
iniciarNatal()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
