import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    user: {
      id: string;
      email: string;
      name: string;
      avatar_url: string | null;
      wallet_balance: string;
      is_admin: boolean;
      is_platform_admin: boolean;
      is_banned: boolean;
      user_type?: "individual" | "student" | "employee" | null;
      username?: string | null;
      college_name?: string | null;
      student_id?: string | null;
      company_name?: string | null;
      membership_type?: string | null;
      entered_reference_id?: string | null;
      onboarding_completed?: boolean;
    };
    tenant: {
      id: string;
      slug: string;
    };
  }
}
