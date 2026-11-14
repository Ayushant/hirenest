import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export const PrivacyPolicyPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <Link
          to="/landing"
          className="inline-flex items-center gap-1.5 text-[13px] text-[#858175] hover:text-[#1A56C2] mb-8"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to HireNestOS
        </Link>

        <h1 className="text-[28px] font-bold text-[#14213D] mb-2">Privacy Policy</h1>
        <p className="text-[14px] text-[#858175] mb-10">
          Last updated: November 2026 · HireNest Workforce Pvt Ltd
        </p>

        <div className="space-y-8 text-[14px] leading-[24px] text-[#46423B]">
          <Section title="1. Information We Collect">
            <p>When you apply for early access or use HireNestOS, we may collect:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Contact information (name, email address, phone number)</li>
              <li>Company information (company name, size, industry, website)</li>
              <li>Professional details (job title, role)</li>
              <li>Application preferences (modules of interest, hiring challenges)</li>
              <li>Usage data and analytics when you use the platform</li>
            </ul>
          </Section>

          <Section title="2. How We Use Your Information">
            <p>We use the information we collect to:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Evaluate and process your early access application</li>
              <li>Contact you about your application status and HireNestOS updates</li>
              <li>Set up and maintain your HireNestOS workspace</li>
              <li>Provide customer support and respond to inquiries</li>
              <li>Improve our platform and develop new features</li>
              <li>Send relevant product announcements (you can opt out anytime)</li>
            </ul>
          </Section>

          <Section title="3. Data Storage & Security">
            <p>
              Your data is stored securely using industry-standard encryption and hosted on
              infrastructure with SOC 2 compliance. We implement appropriate technical and
              organizational measures to protect your personal information against unauthorized
              access, alteration, disclosure, or destruction.
            </p>
          </Section>

          <Section title="4. Data Sharing">
            <p>
              We do not sell, rent, or trade your personal information to third parties. We may share
              data with trusted service providers who assist in operating our platform (e.g., cloud
              hosting, email services), subject to strict confidentiality agreements.
            </p>
          </Section>

          <Section title="5. Data Retention">
            <p>
              We retain your information for as long as your account is active or as needed to
              provide services. Early access application data is retained for the duration of the
              evaluation process and up to 12 months after a decision is made. You may request
              deletion at any time.
            </p>
          </Section>

          <Section title="6. Your Rights">
            <p>You have the right to:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Access the personal data we hold about you</li>
              <li>Request correction of inaccurate data</li>
              <li>Request deletion of your data</li>
              <li>Withdraw consent for data processing</li>
              <li>Request a copy of your data in a portable format</li>
            </ul>
          </Section>

          <Section title="7. Cookies">
            <p>
              HireNestOS uses essential cookies for authentication and session management. We do not
              use third-party advertising cookies. Analytics cookies are used only to improve the
              platform experience.
            </p>
          </Section>

          <Section title="8. Contact Us">
            <p>
              For any privacy-related questions or to exercise your data rights, contact us at:{' '}
              <a href="mailto:hireatkind@gmail.com" className="text-[#1A56C2] hover:underline">
                hireatkind@gmail.com
              </a>
            </p>
          </Section>

          <div className="border-t border-[#E3DDD3] pt-6 mt-10 text-[13px] text-[#A39F92]">
            <p>
              HireNest Workforce Pvt Ltd · Built by{' '}
              <a href="https://atkind.com" target="_blank" rel="noopener noreferrer" className="hover:underline">
                Atkind Pvt Ltd
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section>
    <h2 className="text-[18px] font-semibold text-[#14213D] mb-3">{title}</h2>
    {children}
  </section>
);
