const LEGAL_URL = process.env.NEXT_PUBLIC_LEGAL_URL ?? "https://worldwideview.dev/legal"

export function LegalFooter() {
  return (
    <footer className="legal-footer">
      <a
        href={`${LEGAL_URL}/privacy-policy`}
        target="_blank"
        rel="noopener noreferrer"
      >
        Privacy Policy
      </a>
      <a
        href={`${LEGAL_URL}/cloud-terms-of-service`}
        target="_blank"
        rel="noopener noreferrer"
      >
        Terms of Service
      </a>
    </footer>
  );
}
