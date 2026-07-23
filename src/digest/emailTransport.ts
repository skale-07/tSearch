export interface EmailTransport {
  send(input: {
    to: string[];
    from: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<{ messageId: string }>;
}

export class TestEmailTransport implements EmailTransport {
  public sent: Array<{
    to: string[];
    from: string;
    subject: string;
    html: string;
    text: string;
  }> = [];

  async send(input: {
    to: string[];
    from: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<{ messageId: string }> {
    this.sent.push(input);
    return { messageId: `test-${this.sent.length}` };
  }
}

export class ResendEmailTransport implements EmailTransport {
  constructor(private apiKey: string) {}

  async send(input: {
    to: string[];
    from: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<{ messageId: string }> {
    const { Resend } = await import("resend");
    const resend = new Resend(this.apiKey);
    const result = await resend.emails.send({
      from: input.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    if (result.error) {
      throw new Error(`Resend error: ${result.error.message}`);
    }
    return { messageId: result.data?.id ?? "unknown" };
  }
}
