import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'

/**
 * Página de redirección inteligente para la raíz (/)
 * - Si autenticado → va al dashboard
 * - Si no autenticado → va al portal público
 */
export default function RedirectPage() {
  const navigate = useNavigate()
  const { isAuthenticated } = useAuthStore()

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard', { replace: true })
    } else {
      navigate('/portal', { replace: true })
    }
  }, [isAuthenticated, navigate])

  // No renderizar nada mientras redirige
  return null
}
