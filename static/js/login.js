(function () {
    const form = document.getElementById('login-form');
    const errorBox = document.getElementById('login-error');
    const submitBtn = document.getElementById('login-submit');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');

    document.querySelectorAll('.demo-account-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            usernameInput.value = btn.dataset.username;
            passwordInput.value = btn.dataset.password;
        });
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        errorBox.classList.add('hidden');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Signing in...';

        try {
            await apiRequest('/api/auth/login', {
                method: 'POST',
                body: {
                    username: usernameInput.value.trim(),
                    password: passwordInput.value,
                },
            });
            window.location.href = '/dashboard';
        } catch (err) {
            errorBox.textContent = err.message;
            errorBox.classList.remove('hidden');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Sign In';
        }
    });
})();
