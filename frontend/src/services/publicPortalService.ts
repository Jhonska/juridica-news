import axios from 'axios'

// ✅ FIXED: Use relative API path for production compatibility
// - Development: Will work with Vite proxy (http://localhost:3001 via vite.config.ts)
// - Production: Will use the same domain as frontend (https://domain.com/api)
const API_URL = import.meta.env.VITE_API_URL || '/api'

// Tipo base para artículos con imágenes
interface BasePortalArticle {
  id: string
  title: string
  slug: string
  publishedAt: string
  readingTime: number
  generatedImages?: Array<{
    id: string
    filename: string
    url?: string
    fallbackUrl?: string
    width?: number
    height?: number
    metaDescription?: string
  }>
  imageUrl?: string // Campo procesado por el backend
}

export interface PortalSections {
  // ✅ ACTUALIZADO: General dividido en 3 bloques visuales (mantiene empuje 1-6)
  generalTop: Array<BasePortalArticle & {
    summary: string
    viewCount?: number
    author: {
      firstName: string
      lastName: string
    }
  }>  // Posiciones 1-2 (superior)
  generalMiddle: Array<BasePortalArticle & {
    summary: string
    viewCount?: number
    author: {
      firstName: string
      lastName: string
    }
  }>  // Posiciones 3-4 (medio, después de Últimas Noticias)
  generalBottom: Array<BasePortalArticle & {
    summary: string
    viewCount?: number
    author: {
      firstName: string
      lastName: string
    }
  }>  // Posiciones 5-6 (inferior, después de Instituciones)
  ultimasNoticias: Array<BasePortalArticle>
  entidades: Record<string, Array<BasePortalArticle & {
    summary: string
    entidadSeleccionada: string
  }>>
  destacados: Array<BasePortalArticle & {
    summary: string
    author: {
      firstName: string
      lastName: string
    }
  }>
}

export interface ArticlesByArea {
  data: Array<BasePortalArticle & {
    summary: string
    viewCount?: number
    tags: string[]
    author: {
      firstName: string
      lastName: string
    }
  }>
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
  }
}

export const publicPortalService = {
  /**
   * Obtiene todas las secciones del portal organizadas
   */
  async getPortalSections(): Promise<PortalSections> {
    try {
      const response = await axios.get(`${API_URL}/public/portal-sections`)
      return response.data.data
    } catch (error) {
      console.error('Error fetching portal sections:', error)
      // Fallback a datos vacíos en caso de error
      return {
        generalTop: [],
        generalMiddle: [],
        generalBottom: [],
        ultimasNoticias: [],
        entidades: {},
        destacados: []
      }
    }
  },

  /**
   * Obtiene artículos por área legal para las páginas de sección
   */
  async getArticlesByLegalArea(
    legalArea: string,
    page: number = 1,
    limit: number = 10
  ): Promise<ArticlesByArea> {
    try {
      const response = await axios.get(
        `${API_URL}/public/articles/by-legal-area/${legalArea}`,
        {
          params: { page, limit }
        }
      )
      return response.data
    } catch (error) {
      console.error(`Error fetching articles for ${legalArea}:`, error)
      return {
        data: [],
        pagination: {
          page: 1,
          limit: 10,
          total: 0,
          totalPages: 0,
          hasNext: false,
          hasPrev: false
        }
      }
    }
  },

  /**
   * Obtiene un artículo específico por slug
   */
  async getArticleBySlug(slug: string) {
    try {
      const response = await axios.get(`${API_URL}/public/articles/${slug}`)
      return response.data.data
    } catch (error) {
      console.error(`Error fetching article ${slug}:`, error)
      return null
    }
  }
}

// Mapeo de entidades para mostrar nombres amigables
export const getEntityDisplayName = (entity: string): string => {
  const entityNames: Record<string, string> = {
    'CORTE_CONSTITUCIONAL': 'Corte Constitucional',
    'CORTE_SUPREMA': 'Corte Suprema de Justicia',
    'CONSEJO_ESTADO': 'Consejo de Estado',
    'TRIBUNAL_SUPERIOR': 'Tribunal Superior',
    'FISCALIA_GENERAL': 'Fiscalía General',
    'PROCURADURIA_GENERAL': 'Procuraduría General',
    'CONTRALORIA_GENERAL': 'Contraloría General',
    'MINISTERIO_JUSTICIA': 'Ministerio de Justicia'
  }
  return entityNames[entity] || entity
}

// Mapeo de áreas legales
export const getLegalAreaDisplayName = (area: string): string => {
  const areaNames: Record<string, string> = {
    'CIVIL': 'Derecho Civil',
    'PENAL': 'Derecho Penal',
    'MERCANTIL': 'Derecho Comercial',
    'LABORAL': 'Derecho Laboral',
    'ADMINISTRATIVO': 'Derecho Administrativo',
    'FISCAL': 'Derecho Fiscal y Aduanero',
    'CONSTITUCIONAL': 'Derecho Constitucional',
    'REGULATORIO': 'Derecho Regulatorio',
    'SOCIETARIO': 'Derecho Societario'
  }
  return areaNames[area] || area
}