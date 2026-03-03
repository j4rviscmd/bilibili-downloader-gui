/**
 * Login Page
 *
 * Root page component for Bilibili QR code authentication.
 * This page displays a centered card containing the QR code login interface.
 *
 * The login flow works as follows:
 * 1. User opens the login page
 * 2. QR code is automatically generated and displayed
 * 3. User scans the QR code with Bilibili mobile app
 * 4. User confirms login on their phone
 * 5. Session is established and user is redirected to home
 *
 * @module LoginPage
 *
 * @example
 * ```tsx
 * import { LoginPage } from '@/pages/login'
 *
 * function App() {
 *   return <Routes><Route path="/login" element={<LoginPage />} /></Routes>
 * }
 * ```
 */

import { QRCodeDisplay } from '@/features/login'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { LogIn } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * LoginPage component props.
 *
 * This component does not accept any props as it is a standalone page
 * that manages its own state and navigation.
 */
export interface LoginPageProps {}

/**
 * Login page component.
 *
 * Displays a centered card with the Bilibili QR code login interface.
 * The page is responsive and works on both desktop and mobile devices.
 *
 * After successful login, the user is automatically redirected to the
 * home page by the {@link QRCodeDisplay} component.
 *
 * @returns {JSX.Element} The login page component
 *
 * @example
 * ```tsx
 * import { LoginPage } from '@/pages/login'
 *
 * function App() {
 *   return (
 *     <Routes>
 *       <Route path="/login" element={<LoginPage />} />
 *     </Routes>
 *   )
 * }
 * ```
 */
export function LoginPage() {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="flex items-center justify-center gap-2">
            <LogIn className="h-5 w-5" />
            {t('login.title', 'Login to Bilibili')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <QRCodeDisplay />
        </CardContent>
      </Card>
    </div>
  )
}

export default LoginPage
