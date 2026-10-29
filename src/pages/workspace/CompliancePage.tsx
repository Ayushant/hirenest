import React from 'react';
import { PageHeader } from '../../components/ui/kit';
import { OrganizationOnboardingPanel } from '../../components/domain/OrganizationOnboardingPanel';
import { useAuth } from '../../auth/AuthProvider';

export const CompliancePage: React.FC = () => {
  const { profile, organization } = useAuth();

  if (!profile?.org_id) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Compliance & NDA"
          description="Upload organization documents and track NDA verification status."
        />
        <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
          Your profile is not linked to an organization yet. Contact HireNest support to
          complete onboarding.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compliance & NDA"
        description={
          organization
            ? `${organization.name} · Submit the documents HireNest requires to approve protected collaboration.`
            : 'Submit the documents HireNest requires to approve protected collaboration.'
        }
      />
      <OrganizationOnboardingPanel orgId={profile.org_id} isAdmin={false} allowUpload />
    </div>
  );
};
