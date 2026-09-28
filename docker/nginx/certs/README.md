Put your TLS certificate here before starting `docker-compose.prod.yml`:

```
fullchain.pem
privkey.pem
```

See DEPLOY.md's "Production" section for how to get a real one from Let's
Encrypt. Both filenames are gitignored — never commit a real private key.
