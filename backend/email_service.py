"""Email notification service using Gmail SMTP.

Sends notification emails via Gmail SMTP with App Password authentication.

Required environment variables:
    GMAIL_USER          — Gmail address used as sender (e.g. mcqshk@gmail.com)
    GMAIL_APP_PASSWORD  — 16-char App Password generated from Google Account settings

Setup steps:
    1. Enable 2-Step Verification on the Gmail account
    2. Go to Google Account → Security → App Passwords
    3. Generate a new App Password for "Mail" / "Other"
    4. Set the two env vars above in Cloud Run or .env
"""

import logging
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

logger = logging.getLogger(__name__)

GMAIL_USER = os.getenv("GMAIL_USER", "")
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD", "")
ADMIN_EMAIL = os.getenv("ADMIN_NOTIFY_EMAIL", "mcqshk@gmail.com")

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587


def _is_configured() -> bool:
    """Check if Gmail SMTP credentials are available."""
    return bool(GMAIL_USER and GMAIL_APP_PASSWORD)


def _send_email(to: str, subject: str, html_body: str) -> bool:
    """Send an email via Gmail SMTP. Returns True on success, False on failure.

    This function never raises — errors are logged and swallowed so that
    email failures do not block the main API flow.
    """
    if not _is_configured():
        logger.warning("Email not sent — GMAIL_USER / GMAIL_APP_PASSWORD not configured.")
        return False

    try:
        msg = MIMEMultipart("alternative")
        msg["From"] = GMAIL_USER
        msg["To"] = to
        msg["Subject"] = subject
        msg.attach(MIMEText(html_body, "html", "utf-8"))

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as server:
            server.starttls()
            server.login(GMAIL_USER, GMAIL_APP_PASSWORD)
            server.sendmail(GMAIL_USER, to, msg.as_string())

        logger.info("Email sent to %s — subject: %s", to, subject)
        return True

    except Exception:
        logger.exception("Failed to send email to %s", to)
        return False


# ──────────────────── Notification helpers ────────────────────────────────────


def notify_admin_new_user(user_email: str, display_name: str, uid: str) -> bool:
    """Notify admin that a new user has registered (pending approval).

    Sent to ADMIN_EMAIL (default: mcqshk@gmail.com).
    """
    subject = "📋 新用戶申請 — PDF 文字擷取系統"
    html = f"""\
<div style="font-family: Arial, sans-serif; max-width: 600px;">
    <h2 style="color: #007acc;">新用戶申請通知</h2>
    <p>有新用戶註冊，等待審批：</p>
    <table style="border-collapse: collapse; width: 100%;">
        <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">姓名</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{display_name or '（未填寫）'}</td>
        </tr>
        <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">電郵</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{user_email or '（未填寫）'}</td>
        </tr>
        <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">UID</td>
            <td style="padding: 8px; border: 1px solid #ddd; font-size: 12px; color: #666;">{uid}</td>
        </tr>
    </table>
    <p style="margin-top: 16px;">
        請登入管理員面板審批此用戶。
    </p>
    <p style="color: #999; font-size: 12px;">
        此郵件由系統自動發送，請勿直接回覆。
    </p>
</div>"""
    return _send_email(ADMIN_EMAIL, subject, html)


def notify_user_activated(user_email: str, display_name: str) -> bool:
    """Notify a user that their account has been approved and activated.

    Sent to the user's own email address.
    """
    if not user_email:
        logger.warning("Cannot send activation email — user has no email address.")
        return False

    subject = "✅ 帳號已啟用 — PDF 文字擷取系統"
    name = display_name or "用戶"
    html = f"""\
<div style="font-family: Arial, sans-serif; max-width: 600px;">
    <h2 style="color: #28a745;">帳號啟用通知</h2>
    <p>{name}，您好！</p>
    <p>您的帳號已經通過審批並成功啟用。</p>
    <p>您現在可以登入系統使用所有功能：</p>
    <p style="margin: 20px 0;">
        <a href="https://pdf-text-extraction-488009.web.app"
           style="background: #007acc; color: white; padding: 12px 24px;
                  text-decoration: none; border-radius: 4px; font-weight: bold;">
            前往系統
        </a>
    </p>
    <p>如有任何問題，請聯絡管理員。</p>
    <p style="color: #999; font-size: 12px;">
        此郵件由系統自動發送，請勿直接回覆。
    </p>
</div>"""
    return _send_email(user_email, subject, html)
