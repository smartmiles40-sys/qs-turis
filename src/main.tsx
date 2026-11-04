import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './index.css'
import './styles/ponte.css'
import App from './App.tsx'
import { iniciarAtualizacaoAutomatica } from './lib/versao'
import { instalarTecladoCelular } from './lib/tecladoCelular'

// Deploy novo entra sozinho na aba aberta (ver src/lib/versao.ts).
iniciarAtualizacaoAutomatica()
// Celular: a conversa do WhatsApp acompanha o teclado (só abaixo de 768 px).
instalarTecladoCelular()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
