import { Router } from "express";
import jwt from "jsonwebtoken";

const router = Router();

router.post("/login", (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ error: "비밀번호를 입력하세요." });
  }

  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "비밀번호가 올바르지 않습니다." });
  }

  const token = jwt.sign(
    { isAdmin: true },
    process.env.JWT_SECRET,
    { expiresIn: "12h" }
  );

  res.json({ token });
});

export default router;