'use strict';
(() => {
  const form = document.getElementById('loginForm');
  const login = document.getElementById('login');
  const password = document.getElementById('password');
  const errorBox = document.getElementById('loginError');
  const query = new URLSearchParams(window.location.search);
  const sessionNotices = {
    expired: 'Сессия истекла или завершена. Войдите снова, чтобы продолжить работу.',
    invalid: 'Токен авторизации недействителен. Войдите снова, чтобы продолжить работу.',
    required: 'Войдите в систему, чтобы продолжить работу.',
  };
  if (sessionNotices[query.get('reason')]) Exam.message(document.getElementById('loginNotice'),sessionNotices[query.get('reason')],'info');
  document.getElementById('togglePassword').addEventListener('click', event => {
    const visible = password.type === 'password';
    password.type = visible ? 'text' : 'password';
    event.currentTarget.textContent = visible ? 'Скрыть' : 'Показать';
    event.currentTarget.setAttribute('aria-label', visible ? 'Скрыть пароль' : 'Показать пароль');
    event.currentTarget.setAttribute('aria-pressed',String(visible));
  });
  [login,password].forEach(input => input.addEventListener('input', () => {
    input.removeAttribute('aria-invalid');
    document.getElementById(`${input.id}FieldError`).hidden = true;
    errorBox.hidden = true;
  }));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    let firstInvalid;
    [login,password].forEach(input => {
      const invalid = input === login ? !input.value.trim() : !input.value;
      document.getElementById(`${input.id}FieldError`).hidden = !invalid;
      input.setAttribute('aria-invalid',String(invalid));
      input.setAttribute('aria-describedby',`${input.id}FieldError`);
      if (invalid && !firstInvalid) firstInvalid = input;
    });
    if (firstInvalid) { firstInvalid.focus(); return; }
    Exam.message(errorBox,'');
    try {
      await Exam.busy(document.getElementById('loginSubmit'),'Проверяем…', () => Exam.json('/api/auth/login','POST',{login:login.value.trim(),password:password.value}));
      const next = query.get('next') || query.get('returnTo');
      let destination = '/';
      if (next) {
        try {
          const candidate = new URL(next, window.location.origin);
          if (candidate.origin === window.location.origin && !candidate.pathname.startsWith('/login')) destination = candidate.pathname + candidate.search + candidate.hash;
        } catch {}
      }
      window.location.replace(destination);
    } catch (error) {
      Exam.message(errorBox,error.status === 401 ? 'Неверный логин или пароль. Проверьте данные и повторите попытку.' : error.message);
      password.focus();
    }
  });
})();
