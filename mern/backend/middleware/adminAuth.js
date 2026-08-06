import jwt from "jsonwebtoken";

export function adminAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "관리자 로그인이 필요합니다." });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (!payload.isAdmin) {
      return res.status(403).json({ error: "관리자 권한이 없습니다." });
    }
    req.admin = true;
    next();
  } catch (err) {
    return res.status(401).json({ error: "토큰이 유효하지 않거나 만료되었습니다." });
  }
}