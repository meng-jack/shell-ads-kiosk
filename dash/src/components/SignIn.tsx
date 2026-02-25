import { useEffect, useRef } from "react";
import "./SignIn.css";

interface Props {
  onCredential: (credential: string) => void;
}

export default function SignIn({ onCredential }: Props) {
  const btnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // useGoogleAuth (in the parent) has already called initialize() with the
    // correct client_id, callback, and auto_select settings.  We only need to
    // render the button — but we must wait until initialize() has actually
    // been called (i.e. window.google is ready).
    function renderBtn() {
      if (!btnRef.current || !window.google) return;
      // Re-initialise here only to ensure the callback is set to the current
      // onCredential prop reference (safe to call multiple times).
      window.google.accounts.id.initialize({
        client_id:
          "753871561934-ruse0p8a2k763umnkuj9slq9tlemim9o.apps.googleusercontent.com",
        callback: (r) => onCredential(r.credential),
        auto_select: true,
      });
      window.google.accounts.id.renderButton(btnRef.current, {
        theme: "outline",
        size: "large",
        shape: "rectangular",
        width: 280,
        text: "signin_with",
      });
    }

    if (window.google) {
      renderBtn();
    } else {
      const id = window.setInterval(() => {
        if (window.google) {
          clearInterval(id);
          renderBtn();
        }
      }, 150);
      return () => clearInterval(id);
    }
  }, [onCredential]);

  return (
    <div className="si-wrap">
      <p className="si-wordmark">Startup Shell</p>
      <p className="si-title">Submit an Ad</p>
      <p className="si-sub">
        Sign in with your Google account to submit ads for review.
      </p>
      <div className="si-btn-wrap" ref={btnRef} />
      <p className="si-note">
        Your name and email are attached to your submission so admins can
        contact you.
      </p>
    </div>
  );
}
