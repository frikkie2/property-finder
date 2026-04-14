import { NextRequest } from "next/server";
import { getSearch } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let lastStatus = "";

      const interval = setInterval(() => {
        const search = getSearch(id);
        if (!search) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ status: "failed", message: "Search not found" })}\n\n`)
          );
          clearInterval(interval);
          controller.close();
          return;
        }

        if (search.status !== lastStatus) {
          lastStatus = search.status;
          const candidateCount = search.candidates?.length || 0;
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                status: search.status,
                candidateCount,
                errorMessage: search.error_message,
              })}\n\n`
            )
          );
        }

        if (search.status === "complete" || search.status === "failed") {
          clearInterval(interval);
          controller.close();
        }
      }, 1000);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
