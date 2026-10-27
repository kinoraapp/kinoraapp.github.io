import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { RequireAdmin, RequireAuth, RequireUploader } from "./auth/guards";
import { PageLoader } from "./components/Feedback";
import { AppShell } from "./components/Layout";
import { ToastProvider } from "./components/Toast";
import { env } from "./config/env";
import HomePage from "./pages/HomePage";
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from "./pages/AuthPages";
import { NotFoundPage, PrivacyPage, SetupPage, TermsPage } from "./pages/StaticPages";

// Larger, less-visited screens load on demand to keep the first load small on phones.
const ExplorePage = lazy(() => import("./pages/ExplorePage"));
const VideoPage = lazy(() => import("./pages/VideoPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const UploadPage = lazy(() => import("./pages/UploadPage"));
const StudioPage = lazy(() => import("./pages/StudioPage"));
const EditVideoPage = lazy(() => import("./pages/EditVideoPage"));
const InboxPage = lazy(() => import("./pages/InboxPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const LibraryPage = lazy(() => import("./pages/LibraryPage").then((m) => ({ default: m.LibraryPage })));
const PlaylistPage = lazy(() => import("./pages/LibraryPage").then((m) => ({ default: m.PlaylistPage })));

/** Password-reset links sign the user in with a recovery session; send them to the reset form. */
function RecoveryRedirect() {
  const { recovering } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (recovering && location.pathname !== "/reset-password") navigate("/reset-password", { replace: true });
  }, [recovering, location.pathname, navigate]);
  return null;
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.getElementById("main")?.scrollTo?.(0, 0);
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  if (!env.configured) return <SetupPage />;
  return (
    <BrowserRouter basename={env.basePath.replace(/\/$/, "") || "/"}>
      <ToastProvider>
        <AuthProvider>
          <RecoveryRedirect />
          <ScrollToTop />
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="login" element={<LoginPage />} />
              <Route path="register" element={<RegisterPage />} />
              <Route path="forgot-password" element={<ForgotPasswordPage />} />
              <Route path="reset-password" element={<ResetPasswordPage />} />
              <Route element={<AppShell />}>
                <Route index element={<HomePage />} />
                <Route path="explore" element={<ExplorePage />} />
                <Route path="v/:id" element={<VideoPage />} />
                <Route path="u/:username" element={<ProfilePage />} />
                <Route path="upload" element={<RequireAuth><RequireUploader><UploadPage /></RequireUploader></RequireAuth>} />
                <Route path="studio" element={<RequireAuth><RequireUploader><StudioPage /></RequireUploader></RequireAuth>} />
                <Route path="studio/videos/:id" element={<RequireAuth><EditVideoPage /></RequireAuth>} />
                <Route path="library" element={<RequireAuth><LibraryPage /></RequireAuth>} />
                <Route path="library/playlists/:id" element={<PlaylistPage />} />
                <Route path="inbox" element={<RequireAuth><InboxPage /></RequireAuth>} />
                <Route path="settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
                <Route path="admin" element={<RequireAuth><RequireAdmin><AdminPage /></RequireAdmin></RequireAuth>} />
                <Route path="privacy" element={<PrivacyPage />} />
                <Route path="terms" element={<TermsPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </Suspense>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
