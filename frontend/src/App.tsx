import { Routes, Route } from 'react-router-dom'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { MainLayout } from '@/components/layout/MainLayout'

// Pages
import LoginPage from '@/pages/auth/LoginPage'
import DashboardPage from '@/pages/dashboard/DashboardPage'
import CurationPage from '@/pages/curation/CurationPage'
import ApprovedDocumentsPage from '@/pages/curation/ApprovedDocumentsPage'
import ArticleRouter from '@/pages/articles/ArticleRouter'
import ArticleEditorPage from '@/pages/articles/ArticleEditorPage'
import PublicPortalPage from '@/pages/public/PublicPortalPage'
import PublicArticlePage from '@/pages/public/PublicArticlePage'

// Section Pages
import AdministrativoPage from '@/pages/public/AdministrativoPage'
import CivilPage from '@/pages/public/CivilPage'
import ComercialPage from '@/pages/public/ComercialPage'
import ConstitucionalPage from '@/pages/public/ConstitucionalPage'
import DigitalPage from '@/pages/public/DigitalPage'
import FamiliaPage from '@/pages/public/FamiliaPage'
import FiscalPage from '@/pages/public/FiscalPage'
import LaboralPage from '@/pages/public/LaboralPage'
import OpinionPage from '@/pages/public/OpinionPage'
import PenalPage from '@/pages/public/PenalPage'
import RegulatorioPage from '@/pages/public/RegulatorioPage'
import SocietarioPage from '@/pages/public/SocietarioPage'
import TributarioPage from '@/pages/public/TributarioPage'

function App() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Routes>
        {/* Root route - Show public portal by default */}
        <Route path="/" element={<PublicPortalPage />} />

        {/* Public routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/portal" element={<PublicPortalPage />} />
        <Route path="/portal/articles/:slug" element={<PublicArticlePage />} />
        
        {/* Section routes */}
        <Route path="/portal/administrativo" element={<AdministrativoPage />} />
        <Route path="/portal/civil" element={<CivilPage />} />
        <Route path="/portal/comercial" element={<ComercialPage />} />
        <Route path="/portal/constitucional" element={<ConstitucionalPage />} />
        <Route path="/portal/digital" element={<DigitalPage />} />
        <Route path="/portal/familia" element={<FamiliaPage />} />
        <Route path="/portal/fiscal" element={<FiscalPage />} />
        <Route path="/portal/laboral" element={<LaboralPage />} />
        <Route path="/portal/opinion" element={<OpinionPage />} />
        <Route path="/portal/penal" element={<PenalPage />} />
        <Route path="/portal/regulatorio" element={<RegulatorioPage />} />
        <Route path="/portal/societario" element={<SocietarioPage />} />
        <Route path="/portal/tributario" element={<TributarioPage />} />
        
        {/* Protected routes */}
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <MainLayout>
                <Routes>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/curation" element={<CurationPage />} />
                  <Route path="/approved" element={<ApprovedDocumentsPage />} />
                  <Route path="/articles" element={<ArticleRouter />} />
                  <Route path="/articles/:id/edit" element={<ArticleEditorPage />} />
                  <Route path="/articles/new" element={<ArticleEditorPage />} />
                </Routes>
              </MainLayout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </div>
  )
}

export default App