import type { Dictionary } from "./zh";

// 单复数：界面上的数量只有 0、1、多 几种情况，英文只区分 1 和其他，不必动用 Intl.PluralRules
const plural = (count: number, one: string, other: string) => (count === 1 ? one : other);

const en: Dictionary = {
  languageNames: { zh: "Chinese", en: "English", ja: "Japanese" },

  site: {
    description: "A personal blog for practicing full-stack web development.",
  },

  nav: {
    label: "Main",
    skipToContent: "Skip to content",
    posts: "Posts",
    about: "About",
    search: "Search",
  },

  languageSwitcher: {
    label: "Language",
  },

  home: {
    title: "Posts",
    empty: "No posts yet.",
    asideLabel: "About this site",
    about: "About",
    learnMore: "Learn more",
    tags: "Tags",
    tagCount: (count) => `${count} ${plural(count, "post", "posts")}`,
  },

  post: {
    allPosts: "All posts",
    recent: "Recent posts",
    asideLabel: "More posts",
    tags: "Tags",
    views: (count, formatted) => `${formatted} ${plural(count, "view", "views")}`,
    notice: {
      untranslated: (original) => `This post isn’t available in English yet. Showing the original in ${original}.`,
      machine: (original) => `This post was machine-translated from ${original}.`,
      outdated: "The original has been updated since this translation was made.",
      goToOriginal: "Go to the original",
      readOriginal: "Read the original",
      separator: " ",
    },
  },

  markdown: {
    footnoteLabel: "Footnotes",
    footnoteBackLabel: (reference, rereference) => `Back to reference ${reference}${rereference > 1 ? `-${rereference}` : ""}`,
  },

  about: {
    title: "About",
    paragraphs: [
      "This is a blog for practicing full-stack web development. The blog is the vehicle; learning is the goal.",
      "The frontend is built with Next.js, and the API with Hono, Drizzle and PostgreSQL. Features that usually get outsourced to third-party services — comments, authentication, search, view counts — are deliberately built from scratch here.",
    ],
  },

  search: {
    title: "Search",
    fieldLabel: "Search posts",
    placeholder: "Search posts",
    hint: "Searches titles, post content and tags",
    found: (count) => `${count} ${plural(count, "post", "posts")} found`,
    nothingFound: (query) => `No posts found for “${query}”`,
    errorTitle: "Search failed",
    errors: {
      network: "Can’t reach the server. Check your connection and try again.",
      rateLimited: "Too many searches. Please wait a moment and try again.",
      tooLong: (max) => `Search terms can be up to ${max} characters.`,
      unavailable: "Search is temporarily unavailable. Please try again later.",
    },
  },

  comments: {
    heading: "Comments",
    loading: "Loading comments…",
    loadErrorTitle: "Couldn’t load comments",
    retry: "Try again",
    closed: "Comments aren’t open yet.",
    blocked: "You’ve been blocked from commenting.",
    empty: "No comments yet.",
    signIn: "Sign in with GitHub to comment",
    signInHint: "We only read your public GitHub profile (username and avatar).",
    deletedPlaceholder: "This comment was deleted by its author.",
    replyingTo: (login) => `replying to @${login}`,
    edited: "Edited",
    editedAt: (date) => `Edited on ${date}`,
    pending: "Awaiting approval · only visible to you",
    actions: {
      reply: "Reply",
      edit: "Edit",
      delete: "Delete",
    },
    form: {
      newLabel: "Write a comment",
      newPlaceholder: "Share your thoughts…",
      newSubmit: "Post comment",
      editLabel: "Edit comment",
      editSubmit: "Save",
      replyLabel: (login) => `Reply to @${login}`,
      replyPlaceholder: (login) => `Reply to @${login}…`,
      replySubmit: "Reply",
      cancel: "Cancel",
      hintTrusted: "Markdown is supported. Your comment will appear right away.",
      hintModerated: "Markdown is supported. Comments appear once approved, and you can edit yours until then.",
      identityBefore: "Signed in as ",
      identityAfter: "",
      signOut: "Sign out",
      sendErrorTitle: "Couldn’t send",
    },
    notices: {
      submittedPending: "Thanks! Your comment will be visible to everyone once it’s approved.",
      edited: "Comment updated.",
      deleted: "Comment deleted.",
    },
    deleteDialog: {
      title: "Delete this comment?",
      body: "Its content will be removed. This can’t be undone.",
      confirm: "Delete",
      cancel: "Cancel",
    },
    loginResults: {
      cancelled: "You cancelled GitHub authorization, so you’re not signed in.",
      failed: "Signing in with GitHub didn’t work. Please try again.",
      unavailable: "Signing in to comment isn’t available yet.",
    },
    errors: {
      network: "Can’t reach the server. Check your connection and try again.",
      rateLimited: "You’re commenting too often. Please try again in a few minutes.",
      invalid: "This comment couldn’t be accepted. Please check it and try again.",
      unauthorized: "Your session has expired. Please sign in again.",
      forbidden: "You can’t do that. Refresh the page to see the latest status.",
      notFound: "That comment or post no longer exists. Please refresh the page.",
      unavailable: "The service is temporarily unavailable. Please try again later.",
      deleteFailed: "Couldn’t delete the comment. Please try again later.",
      signOutFailed: "Couldn’t sign out. Please try again later.",
    },
  },

  notFound: {
    title: "Page not found",
    text: "The link may be wrong, or the post may have been removed.",
    home: "Back to home",
  },
};

export default en;
