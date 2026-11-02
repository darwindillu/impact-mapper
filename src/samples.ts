// Built-in maps: the same "Conduit" app (RealWorld project) with one React
// frontend and three different backends, scanned with the CLI.

export interface Sample {
  id: string;
  label: string;
  file: string;
  examples: string[];
}

export const SAMPLES: Sample[] = [
  {
    id: "react-spring",
    label: "React + Java (Spring Boot)",
    file: "/samples/react-spring.json",
    examples: [
      "Let users edit their own comments on an article, and email the article author when someone comments.",
      "Let admins hide an article from the feed without deleting it.",
    ],
  },
  {
    id: "react-django",
    label: "React + Python (Django)",
    file: "/samples/react-django.json",
    examples: [
      "Add bookmarks so users can save articles to read later, with a Bookmarks tab on their profile.",
      "Let users block another user so that user's articles and comments are hidden from them.",
    ],
  },
  {
    id: "react-golang",
    label: "React + Go (Gin)",
    file: "/samples/react-golang.json",
    examples: [
      "Show how many times each article was read, on the article page and in the article list.",
      "Let users edit their own comments on an article.",
    ],
  },
];
