# Environment secrets

- Do not read, search, display, or log secret values from environment files or process environments.
- Application code may load and use secrets at runtime.
- Check secret files only for existence and Git ignore status.
- Preserve existing secret files. Do not overwrite them.
- Keep `.env.example` free of secret values.

# Git workflow

- Work and commit directly on `main`.
- Keep `main` as the only local branch.
