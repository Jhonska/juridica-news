import React from 'react'
import { Link } from 'react-router-dom'
import { Clock, User } from 'lucide-react'
import { PublicArticle, getDefaultArticleImage } from '@/types/publicArticle.types'
import { ResponsiveImage } from '@/components/ui/ResponsiveImage'

interface ArticleCardProps {
  article: PublicArticle
  layout?: 'horizontal' | 'vertical' | 'featured' | 'minimal' | 'numbered' | 'institutional'
  size?: 'small' | 'medium' | 'large'
  className?: string
  index?: number
}

const formatDate = (dateString: string): string => {
  const date = new Date(dateString)
  return date.toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}

const formatReadingTime = (readingTime: number): string => {
  return `${readingTime} min`
}

export const ArticleCard: React.FC<ArticleCardProps> = ({
  article,
  layout = 'vertical',
  size = 'medium',
  className = '',
  index
}) => {

  // Generate SEO-optimized article URL
  const articleUrl = `/portal/articles/${article.slug}`

  // Get image URL with fallback hierarchy (simplified)
  const getImageUrl = (): string => {
    // ✅ FIXED: Use relative API path for production compatibility
    // Backend returns imageUrl as: /api/storage/images/filename.jpg
    // Don't add /api prefix if it's already there

    if (article.imageUrl) {
      // Si ya tiene el host completo, usarla tal como está
      if (article.imageUrl.startsWith('http')) {
        return article.imageUrl
      }
      // Si ya comienza con /api/, usarla directamente (no añadir prefijo)
      if (article.imageUrl.startsWith('/api/')) {
        return article.imageUrl
      }
      // Si es otra ruta relativa, agregar /api
      return `/api${article.imageUrl}`
    }

    // Fallback: Imagen por defecto basada en categoría
    return getDefaultArticleImage(article.category)
  }

  const imageUrl = getImageUrl()

  // Layout horizontal (imagen izquierda, contenido derecha)
  if (layout === 'horizontal') {
    return (
      <Link
        to={articleUrl}
        className={`block bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow border border-gray-100 ${className}`}
        title={`Leer artículo completo: ${article.title}`}
        aria-label={`Artículo sobre ${article.category}: ${article.title}`}
      >
        <article>
        <div className="flex">
          <div className="flex-shrink-0 w-36">
            <ResponsiveImage
              src={imageUrl}
              alt={article.title}
              aspectRatio="4/3"
              objectFit="cover"
              className="rounded-l-lg"
              category={article.category}
              sizes="(max-width: 768px) 144px, 144px"
            />
          </div>
          <div className="flex-1 px-4 py-3 sm:px-5 sm:py-4">
            <h3 className="text-sm sm:text-base font-semibold text-gray-900 line-clamp-2 mb-3">
              {article.title}
            </h3>
            <div className="flex items-center text-xs text-gray-500 gap-3">
              <span className="flex items-center gap-1">
                <Clock size={12} />
                {formatReadingTime(article.readingTime)}
              </span>
              <span>
                {formatDate(article.publishedAt)}
              </span>
            </div>
          </div>
        </div>
        </article>
      </Link>
    )
  }

  // Layout destacado (más grande, con más información)
  if (layout === 'featured') {
    return (
      <Link
        to={articleUrl}
        className={`block bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow border border-gray-200 ${className}`}
        title={`Leer artículo destacado: ${article.title}`}
        aria-label={`Artículo destacado sobre ${article.category}: ${article.title}`}
      >
        <article>
        <ResponsiveImage
          src={imageUrl}
          alt={article.title}
          aspectRatio="16/9"
          objectFit="cover"
          className="rounded-t-lg"
          category={article.category}
          priority={true}
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
        />
        <div className="px-5 py-4 sm:px-6 sm:py-5">
          <h3 className="text-lg sm:text-xl font-bold text-gray-900 mb-4">
            {article.title}
          </h3>
          <div className="flex items-center text-sm text-gray-500 gap-4">
            <span className="flex items-center gap-1">
              <Clock size={14} />
              {formatReadingTime(article.readingTime)}
            </span>
            <span>
              {formatDate(article.publishedAt)}
            </span>
            {article.author && (
              <>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <User size={12} />
                  {article.author.firstName} {article.author.lastName}
                </span>
              </>
            )}
          </div>
        </div>
        </article>
      </Link>
    )
  }

  // Layout numbered (número a la izquierda, título y metadatos)
  if (layout === 'numbered') {
    return (
      <Link
        to={articleUrl}
        className={`group block transition-all ${className}`}
        title={`Leer artículo: ${article.title}`}
        aria-label={`Artículo sobre ${article.category}: ${article.title}`}
      >
        <article className="flex items-start gap-4 py-3 px-4 rounded-lg hover:bg-gray-50/50 transition-all">
          {/* Número con diseño moderno */}
          <div
            className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center font-bold text-lg transition-all group-hover:scale-110"
            style={{
              background: 'linear-gradient(135deg, #04315a 0%, #053d6f 100%)',
              color: '#40f3f2',
              boxShadow: '0 2px 8px rgba(4, 49, 90, 0.15)'
            }}
          >
            {typeof index === 'number' ? index + 1 : '•'}
          </div>

          {/* Contenido */}
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-gray-900 line-clamp-2 mb-2 group-hover:text-[#04315a] transition-colors leading-snug">
              {article.title}
            </h3>
            <div className="flex items-center text-xs text-gray-500 gap-3">
              <span className="flex items-center gap-1">
                <Clock size={12} className="text-gray-400" />
                {formatReadingTime(article.readingTime)}
              </span>
              <span className="text-gray-400">•</span>
              <span>
                {formatDate(article.publishedAt)}
              </span>
            </div>
          </div>
        </article>
      </Link>
    )
  }

  // Layout institutional (minimalista y elegante para instituciones - sin imagen)
  if (layout === 'institutional') {
    return (
      <Link
        to={articleUrl}
        className={`group block transition-all ${className}`}
        title={`Leer artículo: ${article.title}`}
        aria-label={`Artículo sobre ${article.category}: ${article.title}`}
      >
        <article className="relative py-4 px-5 rounded-lg transition-all duration-300 hover:bg-gray-50/50">
          {/* Barra lateral decorativa con gradiente de marca */}
          <div
            className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg transition-all duration-300 group-hover:w-1.5"
            style={{
              background: 'linear-gradient(180deg, #04315a 0%, #40f3f2 100%)'
            }}
          />

          {/* Contenido */}
          <div className="pl-4">
            <h3 className="text-sm sm:text-base font-semibold text-gray-900 line-clamp-2 mb-3 group-hover:text-[#04315a] transition-colors leading-relaxed">
              {article.title}
            </h3>

            {/* Metadatos con diseño limpio */}
            <div className="flex items-center text-xs text-gray-500 gap-3">
              <span className="flex items-center gap-1.5">
                <Clock size={13} className="text-gray-400" />
                <span className="font-medium">{formatReadingTime(article.readingTime)}</span>
              </span>
              <span className="text-gray-300">•</span>
              <span className="text-gray-600">
                {formatDate(article.publishedAt)}
              </span>
            </div>
          </div>

          {/* Indicador de hover sutil */}
          <div
            className="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
            style={{ color: '#40f3f2' }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6 3L11 8L6 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </article>
      </Link>
    )
  }

  // Layout minimal (solo título, fecha y tiempo de lectura)
  if (layout === 'minimal') {
    return (
      <Link
        to={articleUrl}
        className={`block bg-white rounded-lg border border-gray-200 hover:border-gray-300 transition-all px-5 py-4 hover:shadow-sm ${className}`}
        title={`Leer artículo: ${article.title}`}
        aria-label={`Artículo sobre ${article.category}: ${article.title}`}
      >
        <article>
        <h3 className="text-sm font-semibold text-gray-900 line-clamp-2 mb-2 hover:text-blue-600 transition-colors">
          {article.title}
        </h3>
        <div className="flex items-center text-xs text-gray-500 gap-3">
          <span className="flex items-center gap-1">
            <Clock size={12} />
            {formatReadingTime(article.readingTime)}
          </span>
          <span>
            {formatDate(article.publishedAt)}
          </span>
        </div>
        </article>
      </Link>
    )
  }

  // Layout vertical por defecto
  return (
    <Link
      to={articleUrl}
      className={`block bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow border border-gray-100 ${className}`}
      title={`Leer artículo completo: ${article.title}`}
      aria-label={`Artículo sobre ${article.category}: ${article.title}`}
    >
      <article>
      <ResponsiveImage
        src={imageUrl}
        alt={article.title}
        aspectRatio="16/9"
        objectFit="cover"
        className="rounded-t-lg"
        category={article.category}
        sizes={
          size === 'small'
            ? "(max-width: 768px) 100vw, 300px"
            : size === 'large'
            ? "(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 400px"
            : "(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 350px"
        }
      />
      <div className={`px-4 py-3 ${size === 'large' ? 'sm:px-5 sm:py-4' : ''}`}>
        <h3 className={`font-semibold text-gray-900 line-clamp-2 mb-3 ${
          size === 'small' ? 'text-sm' : size === 'large' ? 'text-lg' : 'text-base'
        }`}>
          {article.title}
        </h3>
        <div className="flex items-center text-xs text-gray-500 gap-3">
          <span className="flex items-center gap-1">
            <Clock size={12} />
            {formatReadingTime(article.readingTime)}
          </span>
          <span>
            {formatDate(article.publishedAt)}
          </span>
        </div>
      </div>
      </article>
    </Link>
  )
}