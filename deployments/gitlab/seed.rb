# Idempotent GitLab seed for the IDP portal. Run inside the container:
#   gitlab-rails runner /seed.rb
#
# Creates the GitOps group hierarchy the portal expects (it never creates team
# subgroups itself) and a fixed personal access token so the portal config can
# hard-code GITLAB_TOKEN.

TOKEN = ENV["PORTAL_TOKEN"] || "glpat-localdev0123456789abcd"
SUBGROUPS = %w[team-core team-dbaas team-payments]

root = User.find_by_username("root")
raise "root user not found" unless root

def ensure_group(full_path, name, parent, owner)
  existing = Group.find_by_full_path(full_path)
  return existing if existing
  resp = Groups::CreateService.new(owner, name: name, path: name, parent_id: parent&.id).execute
  # Newer GitLab returns a ServiceResponse (payload[:group]); older returns the Group.
  group = resp.respond_to?(:payload) ? resp.payload[:group] : resp
  raise "group #{full_path}: #{group&.errors&.full_messages&.join(", ")}" unless group&.persisted?
  group
end

top = ensure_group("managed-services", "managed-services", nil, root)
SUBGROUPS.each { |sg| ensure_group("managed-services/#{sg}", sg, top, root) }

# Fixed API token (only created once; guarded by name so re-runs are no-ops).
if root.personal_access_tokens.active.where(name: "portal").empty?
  t = root.personal_access_tokens.create!(
    name: "portal", scopes: ["api"], expires_at: 364.days.from_now
  )
  t.set_token(TOKEN)
  t.save!
  puts "created portal token"
else
  puts "portal token already present"
end

puts "seed ok: group=#{top.full_path} subgroups=#{SUBGROUPS.join(",")}"
