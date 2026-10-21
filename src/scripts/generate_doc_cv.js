const fs = require("fs");
const path = require("path");
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  Table,
  TableRow,
  TableCell,
  WidthType,
} = require("docx");

async function generateCV() {
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: "Calibri",
            size: 22, // 11pt
            color: "333333",
          },
          paragraph: {
            spacing: { line: 276, before: 60, after: 60 },
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1000,
              right: 1000,
              bottom: 1000,
              left: 1000,
            },
          },
        },
        children: [
          // Header / Name
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 100 },
            children: [
              new TextRun({
                text: "NETHMINA DILSHAN",
                bold: true,
                size: 36, // 18pt
                color: "0E8C86",
              }),
            ],
          }),

          // Professional Title
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 120 },
            children: [
              new TextRun({
                text: "Full Stack Software Engineer",
                bold: true,
                size: 24, // 12pt
                color: "555555",
              }),
            ],
          }),

          // Contact Information
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 240 },
            children: [
              new TextRun({
                text: "Email: nethmina.test@example.com   |   Phone: +94 77 123 4567   |   Location: Colombo, Sri Lanka\n",
                size: 19,
                color: "666666",
              }),
              new TextRun({
                text: "LinkedIn: linkedin.com/in/nethmina-dilshan   |   GitHub: github.com/nethmina-dev",
                size: 19,
                color: "0E8C86",
              }),
            ],
          }),

          // Section 1: Professional Summary
          createSectionHeader("PROFESSIONAL SUMMARY"),
          new Paragraph({
            spacing: { before: 80, after: 180 },
            children: [
              new TextRun({
                text: "Dynamic, detail-oriented, and results-driven Software Engineer with 3+ years of hands-on experience in architecting, developing, and deploying full-stack web applications. Proficient in React, Node.js, Express, TypeScript, Python, and MySQL. Experienced in designing scalable RESTful APIs, modern responsive user interfaces, and automated data pipelines. Passionate about software architecture best practices, clean code, and AI-assisted coaching tools.",
              }),
            ],
          }),

          // Section 2: Technical Skills
          createSectionHeader("TECHNICAL SKILLS"),
          createBulletPoint("Programming Languages: ", "JavaScript (ES6+), TypeScript, Python, SQL, HTML5, CSS3"),
          createBulletPoint("Frameworks & Libraries: ", "React.js, Next.js, Node.js, Express.js, FastAPI, Vite, Tailwind CSS, Bootstrap"),
          createBulletPoint("Databases & ORM: ", "MySQL, PostgreSQL, MongoDB, Redis, Sequelize, Mongoose, Prisma"),
          createBulletPoint("DevOps & Cloud Tools: ", "Git, GitHub Actions, Docker, AWS (EC2, S3), Linux, Postman"),
          createBulletPoint("Architectures & Practices: ", "RESTful API Design, Microservices, JWT Auth, Agile/Scrum, CI/CD, Unit Testing"),

          // Spacing
          new Paragraph({ spacing: { before: 100 } }),

          // Section 3: Professional Experience
          createSectionHeader("WORK EXPERIENCE"),

          // Role 1
          new Paragraph({
            spacing: { before: 100, after: 40 },
            children: [
              new TextRun({
                text: "Associate Software Engineer",
                bold: true,
                size: 23,
                color: "0B3538",
              }),
              new TextRun({
                text: "   —   Tech Ceylon Solutions | Colombo, Sri Lanka",
                bold: true,
                color: "555555",
              }),
            ],
          }),
          new Paragraph({
            spacing: { after: 80 },
            children: [
              new TextRun({
                text: "January 2024 – Present (Full-Time)",
                italics: true,
                size: 19,
                color: "777777",
              }),
            ],
          }),
          createJobDuty("Architected, developed, and deployed high-performance RESTful APIs using Node.js, Express, and MySQL, efficiently serving 10,000+ daily active user requests."),
          createJobDuty("Engineered interactive, responsive, and accessible client-side dashboards using React, TypeScript, and Tailwind CSS, improving user task completion rate by 28%."),
          createJobDuty("Implemented robust security protocols including JWT authentication, role-based access control (RBAC), and bcrypt password hashing."),
          createJobDuty("Refactored relational database queries, added multi-column indexes, and implemented Redis caching, reducing average API response latency by 35%."),
          createJobDuty("Collaborated actively in sprint planning, code reviews, and CI/CD automation pipelines deployed on cloud servers."),

          // Role 2
          new Paragraph({
            spacing: { before: 140, after: 40 },
            children: [
              new TextRun({
                text: "Software Engineering Intern",
                bold: true,
                size: 23,
                color: "0B3538",
              }),
              new TextRun({
                text: "   —   CyberNet Softworks | Colombo, Sri Lanka",
                bold: true,
                color: "555555",
              }),
            ],
          }),
          new Paragraph({
            spacing: { after: 80 },
            children: [
              new TextRun({
                text: "June 2023 – December 2023 (6 Months)",
                italics: true,
                size: 19,
                color: "777777",
              }),
            ],
          }),
          createJobDuty("Built modular and reusable front-end React components according to Figma design specifications and integrated real-time backend API endpoints."),
          createJobDuty("Developed automated backend utilities for parsing and generating structured analytical PDF and CSV reports."),
          createJobDuty("Created and executed unit test suites with Jest and Supertest, contributing to an 85% test coverage benchmark."),

          // Spacing
          new Paragraph({ spacing: { before: 100 } }),

          // Section 4: Projects
          createSectionHeader("KEY PROJECTS"),
          createProject(
            "Multimodal AI Interview Coaching System",
            "React, TypeScript, Node.js, Express, Python, OpenCV, Web Audio API",
            "Built a comprehensive multimodal candidate interview platform featuring acoustic feature extraction (F0 pitch, jitter, vocal energy), candidate-specific baseline calibration, and facial landmark deviation scoring."
          ),
          createProject(
            "Real-Time Collaborative Code Editor",
            "React, Node.js, WebSockets, Docker, Redis",
            "Engineered a distributed collaborative workspace allowing multiple software engineers to write, debug, and execute code simultaneously with operational transform conflict resolution."
          ),

          // Spacing
          new Paragraph({ spacing: { before: 100 } }),

          // Section 5: Education
          createSectionHeader("EDUCATION"),
          new Paragraph({
            spacing: { before: 80, after: 40 },
            children: [
              new TextRun({
                text: "B.Sc. (Hons) in Information Technology — Specialized in Software Engineering",
                bold: true,
                color: "0B3538",
              }),
            ],
          }),
          new Paragraph({
            spacing: { after: 60 },
            children: [
              new TextRun({
                text: "Sri Lanka Institute of Information Technology (SLIIT)   |   2022 – 2026",
                italics: true,
                size: 19,
                color: "666666",
              }),
            ],
          }),
          new Paragraph({
            spacing: { after: 120 },
            children: [
              new TextRun({
                text: "Relevant Modules: Data Structures & Algorithms, Distributed Systems, Software Architecture, Database Management Systems, Machine Learning Foundations.",
                size: 19,
                color: "555555",
              }),
            ],
          }),

          // Section 6: Certifications
          createSectionHeader("CERTIFICATIONS"),
          createBulletPoint("AWS Certified Cloud Practitioner", "Amazon Web Services (AWS) — Validated cloud architecture knowledge"),
          createBulletPoint("Meta Front-End Developer Professional Certificate", "Meta / Coursera — Advanced React, JavaScript, UX, and performance optimization"),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const outPath1 = path.join(__dirname, "../../Test_Resume_Nethmina.docx");
  const outPath2 = path.join(__dirname, "../../Test_Resume_Document.docx");

  fs.writeFileSync(outPath1, buffer);
  fs.writeFileSync(outPath2, buffer);
  console.log("Successfully created .docx files:", outPath1, outPath2);
}

function createSectionHeader(title) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 160, after: 80 },
    border: {
      bottom: {
        color: "0E8C86",
        space: 4,
        style: BorderStyle.SINGLE,
        size: 12,
      },
    },
    children: [
      new TextRun({
        text: title,
        bold: true,
        size: 24, // 12pt
        color: "0E8C86",
      }),
    ],
  });
}

function createBulletPoint(label, value) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { before: 30, after: 30 },
    children: [
      new TextRun({ text: label, bold: true, color: "0B3538" }),
      new TextRun({ text: value }),
    ],
  });
}

function createJobDuty(duty) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { before: 30, after: 30 },
    children: [new TextRun({ text: duty })],
  });
}

function createProject(name, techStack, description) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { before: 50, after: 50 },
    children: [
      new TextRun({ text: name + " ", bold: true, color: "0B3538" }),
      new TextRun({ text: `[${techStack}]: `, italics: true, color: "0E8C86" }),
      new TextRun({ text: description }),
    ],
  });
}

generateCV().catch((err) => {
  console.error("Failed to generate CV:", err);
  process.exit(1);
});
