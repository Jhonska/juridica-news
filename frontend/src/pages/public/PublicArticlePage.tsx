import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { PublicHeader } from '@/components/public/PublicHeader'
import { PublicFooter } from '@/components/public/PublicFooter'
import { ArticleCard } from '@/components/public/ArticleCard'
import { ResponsiveImage } from '@/components/ui/ResponsiveImage'
import { publicPortalService } from '@/services/publicPortalService'
import { PublicArticle, adaptApiToPublicArticle, getDefaultArticleImage } from '@/types/publicArticle.types'
import {
  Clock,
  Calendar,
  Tag,
  Copy,
  Check,
  User,
  Download
} from 'lucide-react'

// ✅ FIXED: Use relative API path WITHOUT double /api
// In production (Railway), frontend and backend are on same domain
const API_URL = ''  // Empty string = use relative paths

export default function PublicArticlePage() {
  const { slug } = useParams<{ slug: string }>()
  const [copied, setCopied] = useState(false)
  const [article, setArticle] = useState<any>(null)
  const [publicArticle, setPublicArticle] = useState<PublicArticle | null>(null)
  const [relatedArticles, setRelatedArticles] = useState<PublicArticle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadArticle = async () => {
      if (!slug) {
        setError('Slug de artículo no encontrado')
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        setError(null)
        const articleData = await publicPortalService.getArticleBySlug(slug)

        if (articleData) {
          console.log('📄 Article data from API:', articleData)
          setArticle(articleData)
          const adapted = adaptApiToPublicArticle(articleData)
          console.log('🔄 Adapted public article:', adapted)
          console.log('🖼️ Image URL in adapted article:', adapted.imageUrl)
          setPublicArticle(adapted)

          // Cargar artículos relacionados de la misma área legal
          if (articleData.legalArea) {
            try {
              const relatedData = await publicPortalService.getArticlesByLegalArea(
                articleData.legalArea,
                1,
                4 // Máximo 4 artículos relacionados
              )
              // Filtrar para excluir el artículo actual
              const filteredRelated = relatedData.data
                .filter((art: any) => art.slug !== slug)
                .slice(0, 3) // Mostrar máximo 3 artículos relacionados
                .map(adaptApiToPublicArticle)
              setRelatedArticles(filteredRelated)
            } catch (relErr) {
              console.error('Error loading related articles:', relErr)
              // No es crítico, solo no mostramos relacionados
            }
          }
        } else {
          setError('Artículo no encontrado')
        }
      } catch (err) {
        console.error('Error loading article:', err)
        setError('Error al cargar el artículo')
      } finally {
        setLoading(false)
      }
    }

    loadArticle()
  }, [slug])

  const handleSearch = (query: string) => {
    // TODO: Implementar lógica de búsqueda
  }

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Error al copiar:', err)
    }
  }

  const shareToWhatsApp = () => {
    const text = encodeURIComponent(`${article?.title} - ${window.location.href}`)
    window.open(`https://wa.me/?text=${text}`, '_blank')
  }

  const shareToFacebook = () => {
    const url = encodeURIComponent(window.location.href)
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, '_blank')
  }

  const shareToInstagram = () => {
    // Instagram no permite compartir URLs directamente, abrimos la app
    const text = encodeURIComponent(`${article?.title}`)
    // Para Instagram, copiamos el link y abrimos la app
    navigator.clipboard.writeText(window.location.href)
    window.open('https://www.instagram.com/', '_blank')
  }

  const downloadSentence = async () => {
    try {
      if (!article?.sourceDocument?.documentPath) {
        alert('La sentencia no está disponible para descargar')
        return
      }

      // ✅ FIXED: Extraer el nombre del archivo del path
      const fileName = article.sourceDocument.documentPath.split('/').pop()
      if (!fileName) {
        alert('Error al procesar el nombre del archivo')
        return
      }

      // ✅ FIXED: Construir URL correcta al endpoint PDF
      // Use /api/storage/documents/{filename}/pdf
      const downloadUrl = `/api/storage/documents/${fileName}/pdf`

      console.log('📥 Descargando PDF desde:', downloadUrl)

      // ✅ FIXED: Usar fetch() para obtener el PDF con mejor control
      const response = await fetch(downloadUrl)

      if (!response.ok) {
        console.error('❌ Error en descarga:', response.status, response.statusText)
        alert(`Error al descargar: ${response.status} ${response.statusText}`)
        return
      }

      // Verificar que se recibió PDF
      const contentType = response.headers.get('content-type')
      console.log('📄 Content-Type recibido:', contentType)

      if (!contentType?.includes('pdf') && !contentType?.includes('octet-stream')) {
        console.warn('⚠️ Content-Type no es PDF:', contentType)
      }

      // Obtener el blob del PDF
      const blob = await response.blob()
      console.log('📦 Tamaño de PDF descargado:', blob.size, 'bytes')

      // Generar nombre del PDF
      const pdfFileName = fileName.replace(/\.[^/.]+$/, '.pdf') || 'sentencia.pdf'

      // Crear URL de descarga desde el blob
      const blobUrl = URL.createObjectURL(blob)

      // Crear enlace temporal y descargar
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = pdfFileName
      document.body.appendChild(link)
      link.click()

      // Limpiar recursos
      document.body.removeChild(link)
      URL.revokeObjectURL(blobUrl)

      console.log('✅ PDF descargado exitosamente:', pdfFileName)

    } catch (error) {
      console.error('❌ Error descargando sentencia:', error)
      alert('Error al descargar la sentencia. Por favor, intenta nuevamente.')
    }
  }

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString)
    return date.toLocaleDateString('es-CO', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }

  // Estado de carga
  if (loading) {
    return (
      <>
        <PublicHeader onSearch={handleSearch} />
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Cargando artículo...</p>
          </div>
        </div>
        <PublicFooter />
      </>
    )
  }

  // Estado de error o artículo no encontrado
  if (error || !article || !publicArticle) {
    return (
      <>
        <PublicHeader onSearch={handleSearch} />
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900 mb-4">
              {error || 'Artículo no encontrado'}
            </h1>
            <p className="text-gray-600 mb-6">
              {error === 'Error al cargar el artículo'
                ? 'Hubo un problema al cargar el artículo. Por favor, intenta de nuevo.'
                : 'El artículo que buscas no existe o ha sido removido.'
              }
            </p>
            <a 
              href="/portal" 
              className="inline-flex items-center px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors"
              style={{ backgroundColor: '#04315a' }}
            >
              Volver al portal
            </a>
          </div>
        </div>
        <PublicFooter />
      </>
    )
  }

  return (
    <>
      <PublicHeader onSearch={handleSearch} />
      
      <article className="min-h-screen bg-gray-50">
        {/* Metadatos simplificados del artículo */}
        <div className="bg-white border-b border-gray-200">
          <div className="max-w-4xl mx-auto px-6 sm:px-8 py-8 sm:py-12">
            
            {/* Metadatos del artículo - solo fecha, tiempo lectura y etiqueta */}
            <div className="mb-8">
              <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
                <div className="flex items-center gap-1">
                  <Calendar size={16} />
                  <span>{formatDate(publicArticle.publishedAt)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Clock size={16} />
                  <span>{publicArticle.readingTime} min</span>
                </div>
                <div className="flex items-center gap-1">
                  <Tag size={16} />
                  <span
                    className="px-2 py-1 rounded-full text-xs font-medium text-white"
                    style={{ backgroundColor: '#04315a' }}
                  >
                    {publicArticle.category}
                  </span>
                </div>
                {publicArticle.author && (
                  <div className="flex items-center gap-1">
                    <User size={16} />
                    <span>Por {publicArticle.author.firstName} {publicArticle.author.lastName}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Título justo encima de la imagen */}
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 mb-8 leading-tight">
              {publicArticle.title}
            </h1>
          </div>
        </div>

        {/* Imagen del artículo */}
        <div className="bg-white">
          <div className="max-w-4xl mx-auto px-6 sm:px-8">
            <div className="flex justify-center py-4">
              {/* Caja gris con altura fija consistente igual al home en todos los breakpoints */}
              <div className="relative w-64 h-48 sm:w-72 sm:h-54 md:w-80 md:h-60 bg-gray-50 rounded-lg overflow-hidden shadow-sm">
                <img
                  src={publicArticle.imageUrl || getDefaultArticleImage(publicArticle.category)}
                  alt={publicArticle.title}
                  className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"
                  loading="eager"
                  sizes="(max-width: 640px) 256px, (max-width: 768px) 288px, 320px"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Subtítulo/resumen debajo de la imagen */}
        <div className="bg-white">
          <div className="max-w-4xl mx-auto px-6 sm:px-8 py-6">
            <h2 className="text-lg sm:text-xl text-gray-600 mb-6 leading-relaxed font-medium">
              {publicArticle.summary}
            </h2>

            {/* Botones de compartir minimalistas */}
            <div className="flex items-center justify-center gap-3 mb-8">
              {/* Copiar link */}
              <button
                onClick={copyToClipboard}
                className="w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-110"
                style={{ backgroundColor: copied ? '#40f3f2' : '#04315a' }}
                title={copied ? 'Copiado!' : 'Copiar link'}
              >
                {copied ? (
                  <Check size={18} className="text-gray-900" />
                ) : (
                  <Copy size={18} style={{ color: '#40f3f2' }} />
                )}
              </button>

              {/* WhatsApp */}
              <button
                onClick={shareToWhatsApp}
                className="w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-110"
                style={{ backgroundColor: '#04315a' }}
                title="Compartir en WhatsApp"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  style={{ color: '#40f3f2' }}
                >
                  <path
                    fill="currentColor"
                    d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.885 3.787"
                  />
                </svg>
              </button>

              {/* Facebook */}
              <button
                onClick={shareToFacebook}
                className="w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-110"
                style={{ backgroundColor: '#04315a' }}
                title="Compartir en Facebook"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  style={{ color: '#40f3f2' }}
                >
                  <path
                    fill="currentColor"
                    d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"
                  />
                </svg>
              </button>

              {/* Instagram */}
              <button
                onClick={shareToInstagram}
                className="w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-110"
                style={{ backgroundColor: '#04315a' }}
                title="Compartir en Instagram"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  style={{ color: '#40f3f2' }}
                >
                  <path
                    fill="currentColor"
                    d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"
                  />
                </svg>
              </button>

              {/* Descargar Sentencia */}
              {article?.sourceDocument?.documentPath && (
                <button
                  onClick={downloadSentence}
                  className="w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-110"
                  style={{ backgroundColor: '#04315a' }}
                  title="Descargar sentencia original"
                >
                  <Download size={18} style={{ color: '#40f3f2' }} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Contenido del artículo */}
        <div className="bg-white">
          <div className="max-w-4xl mx-auto px-6 sm:px-8 py-8 sm:py-12">
            <div className="prose prose-lg max-w-none">
              <div className="text-gray-700 leading-relaxed whitespace-pre-line">
                {article.content || publicArticle.summary}
              </div>

              {/* Botón de descarga de sentencia */}
              {publicArticle.sourceDocument?.documentPath && (
                <div className="bg-blue-50 border-l-4 border-blue-400 p-4 my-8">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                      <p className="text-blue-800 font-medium">
                        Documento oficial de esta decision
                      </p>
                      <p className="text-blue-600 text-sm mt-1">
                        {publicArticle.sourceDocument.title || 'Sentencia de la Corte Constitucional'}
                      </p>
                    </div>
                    <a
                      href={`${API_URL}/api/storage/documents/${publicArticle.sourceDocument.documentPath}`}
                      download
                      className="inline-flex items-center justify-center px-4 py-2 text-white rounded-lg transition-colors hover:opacity-90"
                      style={{ backgroundColor: '#04315a' }}
                    >
                      <Download size={18} className="mr-2" />
                      Descargar Sentencia
                    </a>
                  </div>
                </div>
              )}
            </div>

            {/* Tags del artículo */}
            {publicArticle.tags && publicArticle.tags.length > 0 && (
              <div className="mt-8 pt-6 border-t border-gray-200">
                <h3 className="text-sm font-medium text-gray-700 mb-3">Etiquetas:</h3>
                <div className="flex flex-wrap gap-2">
                  {publicArticle.tags.map((tag, index) => (
                    <span
                      key={index}
                      className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded-full hover:bg-gray-200 transition-colors cursor-pointer"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Artículos relacionados */}
        <div className="bg-gray-50 border-t border-gray-200">
          <div className="max-w-7xl mx-auto px-6 sm:px-8 py-12">
            <div className="text-center mb-8">
              <h2
                className="text-2xl sm:text-3xl font-bold mb-4"
                style={{ color: '#04315a' }}
              >
                Artículos Relacionados
              </h2>
              <p className="text-gray-600">
                Otros artículos que podrían interesarte sobre el mismo tema
              </p>

              {/* Línea decorativa */}
              <div className="mt-4 flex justify-center">
                <div
                  className="h-1 w-24 rounded-full"
                  style={{ background: 'linear-gradient(to right, #04315a, #40f3f2)' }}
                ></div>
              </div>
            </div>

            {/* Grid de artículos relacionados */}
            {relatedArticles.length > 0 ? (
              <div className="grid gap-6 sm:gap-8 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                {relatedArticles.map((relatedArticle) => (
                  <ArticleCard
                    key={relatedArticle.id}
                    article={relatedArticle}
                    layout="vertical"
                    size="medium"
                    className="h-full"
                  />
                ))}
              </div>
            ) : (
              <div className="text-center text-gray-500">
                <p>No hay artículos relacionados disponibles en este momento.</p>
              </div>
            )}
          </div>
        </div>
      </article>
      
      <PublicFooter />
    </>
  )
}