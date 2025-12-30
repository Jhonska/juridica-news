import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function populatePortalSections() {
  try {
    console.log('🔄 Starting portal sections population...')

    // Obtener todos los artículos publicados
    const articles = await prisma.article.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: { publishedAt: 'desc' }
    })

    console.log(`📊 Found ${articles.length} published articles`)

    if (articles.length === 0) {
      console.log('⚠️  No published articles found')
      return
    }

    // Actualizar primeros 6 artículos para sección General (posiciones 1-6)
    const generalCount = Math.min(6, articles.length)
    for (let i = 0; i < generalCount; i++) {
      await prisma.article.update({
        where: { id: articles[i].id },
        data: {
          isGeneral: true,
          posicionGeneral: i + 1
        }
      })
      console.log(`✅ Article ${i + 1}/6 set as General (position ${i + 1})`)
    }

    // Actualizar siguientes artículos para Últimas Noticias (máximo 5)
    const ultimasCount = Math.min(5, Math.max(0, articles.length - 6))
    for (let i = 0; i < ultimasCount; i++) {
      const articleIndex = 6 + i
      await prisma.article.update({
        where: { id: articles[articleIndex].id },
        data: {
          isUltimasNoticias: true,
          posicionUltimasNoticias: i + 1
        }
      })
      console.log(`✅ Article ${articleIndex + 1} set as Últimas Noticias (position ${i + 1})`)
    }

    // Actualizar siguientes artículos para Destacado de la Semana (máximo 4)
    const destacadosCount = Math.min(4, Math.max(0, articles.length - 6 - 5))
    for (let i = 0; i < destacadosCount; i++) {
      const articleIndex = 6 + 5 + i
      await prisma.article.update({
        where: { id: articles[articleIndex].id },
        data: {
          isDestacadoSemana: true
        }
      })
      console.log(`✅ Article ${articleIndex + 1} set as Destacado Semana`)
    }

    console.log('\n✅ Portal sections populated successfully!')
    console.log(`📈 Summary:`)
    console.log(`   - General section: ${generalCount} articles (positions 1-6)`)
    console.log(`   - Últimas Noticias: ${ultimasCount} articles`)
    console.log(`   - Destacados Semana: ${destacadosCount} articles`)

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

populatePortalSections()
