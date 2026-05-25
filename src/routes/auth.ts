import { Router } from 'express';
import { createToken, authMiddleware, requireAdmin } from '../services/auth.js';
import { findUser, loadUsers, saveUsers } from '../store/users.js';

const router = Router();

// POST /api/auth/login — public
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Missing username or password' });
  }

  const user = findUser(username);
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const payload = { username: user.username, role: user.role };
  const token = createToken(payload);
  res.json({ token, user: payload });
});

// GET /api/auth/me — authenticated
router.get('/me', authMiddleware, (req, res) => {
  res.json({ username: req.user!.username, role: req.user!.role });
});

// GET /api/auth/users — admin only
router.get('/users', authMiddleware, requireAdmin, (_req, res) => {
  const users = loadUsers().map(({ password, ...u }) => u);
  res.json(users);
});

// POST /api/auth/users — admin only
router.post('/users', authMiddleware, requireAdmin, (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Missing username or password' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (role !== 'user' && role !== 'admin') {
    return res.status(400).json({ error: 'Role must be user or admin' });
  }

  if (findUser(username)) {
    return res.status(409).json({ error: 'Username already exists' });
  }

  const users = loadUsers();
  const newUser = { username, password, role, createdAt: Date.now() };
  users.push(newUser);
  saveUsers(users);

  const { password: _, ...safe } = newUser;
  res.json(safe);
});

// PUT /api/auth/users/:username — admin only
router.put('/users/:username', authMiddleware, requireAdmin, (req, res) => {
  const { username } = req.params;
  const { password, role } = req.body;
  const users = loadUsers();
  const target = users.find((u) => u.username === username);
  if (!target) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Prevent self-demotion
  if (role && username === req.user!.username && role !== 'admin') {
    return res.status(400).json({ error: 'Cannot demote yourself' });
  }

  if (password) {
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    target.password = password;
  }
  if (role === 'user' || role === 'admin') {
    target.role = role;
  }

  saveUsers(users);
  const { password: _, ...safe } = target;
  res.json(safe);
});

// DELETE /api/auth/users/:username — admin only
router.delete('/users/:username', authMiddleware, requireAdmin, (req, res) => {
  const { username } = req.params;

  // Prevent self-deletion
  if (username === req.user!.username) {
    return res.status(400).json({ error: 'Cannot delete yourself' });
  }

  const users = loadUsers();
  const idx = users.findIndex((u) => u.username === username);
  if (idx === -1) {
    return res.status(404).json({ error: 'User not found' });
  }

  users.splice(idx, 1);
  saveUsers(users);
  res.json({ ok: true });
});

export default router;
