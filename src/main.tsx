import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './index.css'
import './styles/ponte.css'
import App from './App.tsx'
import { iniciarAtualizacaoAutomatica } from './lib/versao'

// Deploy novo entra sozinho na aba aberta (ver src/lib/versao.ts).
iniciarAtualizacaoAutomatica()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
