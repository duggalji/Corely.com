"use server";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function transcribeUploadedFile(
  resp: {
    name: string;
    size: number;
    key: string;
    url: string;
  }
) {
  if (!resp) {
    return {
      success: false,
      message: "File upload failed",
      data: null,
    };
  }

  const { url: fileUrl, name: fileName } = resp;

  if (!fileUrl || !fileName) {
    return {
      success: false,
      message: "File upload failed",
      data: null,
    };
  }

  const response = await fetch(fileUrl);

  try {
    const transcriptions = await openai.audio.transcriptions.create({
      model: "whisper-1",
      file: response,
    });

    console.log({ transcriptions });
    return {
      success: true,
      message: "File uploaded successfully!",
      data: { transcriptions, userId: 'user-id' }, // You'll need to pass userId separately
    };
  } catch (error) {
    console.error("Error processing file", error);

    if (error instanceof OpenAI.APIError && error.status === 413) {
      return {
        success: false,
        message: "File size exceeds the max limit of 20MB",
        data: null,
      };
    }

    return {
      success: false,
      message: error instanceof Error ? error.message : "Error processing file",
      data: null,
    };
  }
}

async function saveBlogPost(userId: string, title: string, content: string) {
  try {
    const insertedPost = await prisma.post.create({
      data: {
        userId,
        title,
        content,
      },
    });
    return insertedPost.id;
  } catch (error) {
    console.error("Error saving blog post", error);
    throw error;
  }
}

async function getUserBlogPosts(userId: string) {
  try {
    const posts = await prisma.post.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { content: true },
    });
    return posts.map((post: { content: string }) => post.content).join("\n\n");
  } catch (error) {
    console.error("Error getting user blog posts", error);
    throw error;
  }
}

async function generateBlogPost({
  transcriptions,
  userPosts,
}: {
  transcriptions: string;
  userPosts: string;
}) {
  const completion = await openai.chat.completions.create({
    messages: [
      {
        role: "system",
        content:
          "You are a skilled content writer that converts audio transcriptions into well-structured, engaging blog posts in Markdown format. Create a comprehensive blog post with a catchy title, introduction, main body with multiple sections, and a conclusion. Analyze the user's writing style from their previous posts and emulate their tone and style in the new post. Keep the tone casual and professional.",
      },
      {
        role: "user",
        content: `Here are some of my previous blog posts for reference:

${userPosts}

Please convert the following transcription into a well-structured blog post using Markdown formatting. Follow this structure:

1. Start with a SEO friendly catchy title on the first line.
2. Add two newlines after the title.
3. Write an engaging introduction paragraph.
4. Create multiple sections for the main content, using appropriate headings (##, ###).
5. Include relevant subheadings within sections if needed.
6. Use bullet points or numbered lists where appropriate.
7. Add a conclusion paragraph at the end.
8. Ensure the content is informative, well-organized, and easy to read.
9. Emulate my writing style, tone, and any recurring patterns you notice from my previous posts.

Here's the transcription to convert: ${transcriptions}`,
      },
    ],
    model: "gpt-4o-mini",
    temperature: 0.7,
    max_tokens: 1000,
  });

  return completion.choices[0].message.content;
}

export async function generateBlogPostAction({
  transcriptions,
  userId,
}: {
  transcriptions: { text: string };
  userId: string;
}) {
  const userPosts = await getUserBlogPosts(userId);

  let postId = null;

  if (transcriptions) {
    const blogPost = await generateBlogPost({
      transcriptions: transcriptions.text,
      userPosts,
    });

    if (!blogPost) {
      return {
        success: false,
        message: "Blog post generation failed, please try again...",
      };
    }

    const [title] = blogPost?.split("\n\n") || [];

    if (blogPost) {
      postId = await saveBlogPost(userId, title, blogPost);
    }
  }

  revalidatePath(`/posts/${postId}`);
  redirect(`/posts/${postId}`);
}