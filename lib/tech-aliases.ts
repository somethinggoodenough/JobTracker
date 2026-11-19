const aliases: Record<string, string> = {
  go: "Go", golang: "Go", k8s: "Kubernetes", kubernetes: "Kubernetes",
  js: "JavaScript", javascript: "JavaScript", ts: "TypeScript", typescript: "TypeScript",
  postgres: "PostgreSQL", postgresql: "PostgreSQL",
  py: "Python", python: "Python", python3: "Python",
  "c plus plus": "C++", cpp: "C++", "c++": "C++",
  node: "Node.js", nodejs: "Node.js", "node.js": "Node.js",
  react: "React", reactjs: "React", "react.js": "React",
  aws: "AWS", "amazon web services": "AWS", gcp: "GCP", "google cloud": "GCP",
  pytorch: "PyTorch", torch: "PyTorch", tf: "TensorFlow", tensorflow: "TensorFlow",
  sql: "SQL", redis: "Redis", docker: "Docker", cuda: "CUDA", rust: "Rust",
  java: "Java", kafka: "Kafka", mysql: "MySQL", mongodb: "MongoDB", linux: "Linux",
};

export function normalizeTechnology(value: unknown): string {
  if (typeof value !== "string") return "";
  const key = value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  return Object.hasOwn(aliases, key) ? aliases[key] : key;
}

export function normalizeTechnologies(values: unknown[]) {
  return [...new Set(values.map(normalizeTechnology).filter(Boolean))];
}
