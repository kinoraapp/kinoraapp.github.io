import { Link } from "react-router-dom";
import { Compass, Database, KeyRound, Video } from "lucide-react";
import { Logo } from "../components/Brand";
import { brand } from "../config/brand";
import { env } from "../config/env";

const UPDATED = "26 October 2026";

function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className="page page-narrow legal">
      <h1 className="page-title">{title}</h1>
      <p className="muted small">Last updated {UPDATED}</p>
      <p className="notice">
        This is a starting template. Have it reviewed for your country and situation before you launch, and replace the contact
        details.
      </p>
      {children}
    </article>
  );
}

export function PrivacyPage() {
  const app = env.appName;
  return (
    <LegalPage title="Privacy Policy">
      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Account details:</strong> your email address, username, display name, profile picture, bio and website.
        </li>
        <li>
          <strong>Content:</strong> videos, thumbnails, captions, comments, playlists and reports you submit.
        </li>
        <li>
          <strong>Activity:</strong> likes, saves, follows, video views and the access you are given to restricted videos.
        </li>
        <li>
          <strong>Technical data:</strong> basic logs kept by our hosting providers (such as IP address and browser type) for security and
          reliability.
        </li>
      </ul>
      <h2>How we use it</h2>
      <p>
        To run {app}: sign you in, show and deliver videos to the people allowed to watch them, send notifications, keep the community safe
        through moderation, and show creators and administrators aggregate statistics. We do not sell your personal information.
      </p>
      <h2>Who processes it</h2>
      <p>
        Accounts and data are stored with Supabase (database, authentication and image storage). Videos are stored and streamed by Mux.
        The website is served by GitHub Pages. These providers process data on our behalf under their own security and privacy terms.
      </p>
      <h2>Video privacy</h2>
      <p>
        Private, unlisted and “selected users” videos are delivered through short-lived signed links that are only issued after an access
        check. The app does not store videos or your account data in its offline cache, so they are not left on shared devices.
      </p>
      <h2>Your choices</h2>
      <ul>
        <li>Edit your profile, change who can watch your videos, or delete your videos at any time.</li>
        <li>Delete notifications, playlists, comments, likes and saves.</li>
        <li>
          Ask us to export or delete your account by emailing <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>.
        </li>
      </ul>
      <h2>Children</h2>
      <p>{app} is not intended for children under 13 (or the minimum age in your country).</p>
      <h2>Contact</h2>
      <p>
        Questions? Email <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>.
      </p>
    </LegalPage>
  );
}

export function TermsPage() {
  const app = env.appName;
  return (
    <LegalPage title="Terms of Service">
      <h2>Using {app}</h2>
      <p>
        By creating an account or using {app} you agree to these terms. You must be old enough to use online services in your country and
        give accurate account information. Keep your password safe; you're responsible for activity on your account.
      </p>
      <h2>Your content</h2>
      <p>
        You keep ownership of what you upload. You give {app} permission to store, process, display and stream it to the audience you choose
        with its visibility setting. Only upload content you have the rights to.
      </p>
      <h2>Community rules</h2>
      <ul>
        <li>No harassment, hate speech, threats or content that encourages self-harm or violence.</li>
        <li>No sexual content involving minors, and no sexual content in public videos.</li>
        <li>No spam, scams, impersonation or misleading information that could cause harm.</li>
        <li>No content that infringes someone else's copyright or privacy.</li>
      </ul>
      <h2>Moderation</h2>
      <p>
        Administrators can remove content, hide comments, change upload permissions and suspend accounts that break these rules. You can
        report content from any video, comment or profile.
      </p>
      <h2>Availability</h2>
      <p>
        {app} is provided “as is”. We may change or discontinue features, and we're not liable for indirect losses from using the service, to
        the extent the law allows.
      </p>
      <h2>Contact</h2>
      <p>
        Email <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>.
      </p>
    </LegalPage>
  );
}

export function NotFoundPage() {
  return (
    <div className="page page-narrow">
      <div className="empty-state not-found">
        <span className="not-found-code" aria-hidden>
          404
        </span>
        <h1>This page doesn't exist</h1>
        <p>The link may be broken, or the page may have moved.</p>
        <div className="button-row">
          <Link to="/" className="btn btn-primary">
            Go to the feed
          </Link>
          <Link to="/explore" className="btn btn-secondary">
            <Compass size={16} /> Explore
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Shown instead of the app until Supabase credentials are configured. */
export function SetupPage() {
  return (
    <div className="auth-page">
      <div className="auth-card setup">
        <Logo size={40} />
        <h1>Almost there</h1>
        <p className="muted">
          {env.appName} is built and running, but it isn't connected to its backend yet. Add these settings and rebuild (see{" "}
          <code>README.md</code> and <code>docs/SETUP.md</code>):
        </p>
        <ol className="setup-list">
          <li>
            <Database size={18} />
            <span>
              <strong>Supabase</strong>: set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in{" "}
              <code>.env.local</code> (or as GitHub Actions variables), then run the database migrations.
            </span>
          </li>
          <li>
            <Video size={18} />
            <span>
              <strong>Mux</strong>: add the Mux API token, signing key and webhook secret as Supabase Edge Function secrets, then deploy the
              functions.
            </span>
          </li>
          <li>
            <KeyRound size={18} />
            <span>
              <strong>First admin</strong>: register in the app, then run <code>select public.bootstrap_admin('you@example.com');</code> in the
              Supabase SQL editor.
            </span>
          </li>
        </ol>
      </div>
    </div>
  );
}
