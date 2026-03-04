import os
import pytest

import backend.email_service as email_service


def test_is_configured_false(monkeypatch):
    monkeypatch.delenv("GMAIL_USER", raising=False)
    monkeypatch.delenv("GMAIL_APP_PASSWORD", raising=False)
    assert not email_service._is_configured()


def test_is_configured_true(monkeypatch):
    # set module globals directly since _is_configured reads them at import
    email_service.GMAIL_USER = "foo@gmail.com"
    email_service.GMAIL_APP_PASSWORD = "dummy"
    assert email_service._is_configured()


def test_notify_admin_new_user_not_configured(monkeypatch):
    # when not configured, function should return False but not raise
    monkeypatch.delenv("GMAIL_USER", raising=False)
    monkeypatch.delenv("GMAIL_APP_PASSWORD", raising=False)
    ok = email_service.notify_admin_new_user("a@b.com", "Name", "uid123")
    assert ok is False


def test_notify_user_activated_not_configured(monkeypatch):
    monkeypatch.delenv("GMAIL_USER", raising=False)
    monkeypatch.delenv("GMAIL_APP_PASSWORD", raising=False)
    ok = email_service.notify_user_activated("a@b.com", "Name")
    assert ok is False


def test_new_message_and_reply_helpers(monkeypatch):
    monkeypatch.setenv("GMAIL_USER", "foo@gmail.com")
    monkeypatch.setenv("GMAIL_APP_PASSWORD", "dummy")
    sent = []
    monkeypatch.setattr(email_service, "_send_email", lambda to, subj, html: sent.append((to, subj)) or True)
    email_service.notify_admin_new_message("a@b.com", "Alice", "hello")
    email_service.notify_user_reply("a@b.com", "Alice", "hi")
    assert len(sent) == 2
