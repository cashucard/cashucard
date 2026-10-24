# Local React Native podspecs include generated paths/checksums. Preserve their
# dependency graph and all remote pins while allowing local metadata to refresh.
require 'yaml'
def check_pod_lock(before, after)
  old_checksums=before.fetch('SPEC CHECKSUMS')
  new_checksums=after.fetch('SPEC CHECKSUMS')
  graph = ->(lock){lock.reject{|key,_|key=='SPEC CHECKSUMS'}}
  raise 'Pod dependency graph changed; review the lockfile before signing' unless graph.call(before)==graph.call(after)
  raise 'Pod checksum set changed' unless old_checksums.keys.sort==new_checksums.keys.sort
  local=before.fetch('EXTERNAL SOURCES',{}).select do |_,source|
    source.any?{|key,value| %w[path podspec].include?(key.to_s.delete_prefix(':')) && !value.to_s.match?(/\A[a-z]+:\/\//i)}
  end.keys
  old_checksums.each do |name,checksum|
    raise "Remote pod checksum changed: #{name}" unless local.include?(name) || new_checksums[name]==checksum
  end
  true
end
if $PROGRAM_NAME==__FILE__
  check_pod_lock(*ARGV.map{|file|YAML.safe_load_file(file, permitted_classes: [Symbol], aliases:true)})
  puts 'Pod versions, sources and remote checksums match the committed lock.'
end
