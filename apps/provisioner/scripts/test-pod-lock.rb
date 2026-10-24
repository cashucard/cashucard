require 'minitest/autorun'
require_relative 'check-pod-lock'
class PodLockCheckTest < Minitest::Test
  def fixture
    {'PODS'=>['Local (1.0)', 'Remote (2.0)'], 'DEPENDENCIES'=>['Local', 'Remote'],
     'EXTERNAL SOURCES'=>{'Local'=>{path: '../node_modules/local'}},
     'SPEC CHECKSUMS'=>{'Local'=>'original', 'Remote'=>'pinned'}, 'COCOAPODS'=>'1.17.0'}
  end
  def test_only_generated_local_checksums_may_change
    before=fixture; after=Marshal.load(Marshal.dump(before));after['SPEC CHECKSUMS']['Local']='regenerated'
    assert check_pod_lock(before, after)
    assert check_pod_lock(YAML.safe_load(before.to_yaml, permitted_classes: [Symbol]), YAML.safe_load(after.to_yaml, permitted_classes: [Symbol]))
  end
  def test_versions_and_remote_checksums_cannot_drift
    before=fixture
    [->(v){v['PODS'][0]='Local (1.1)'}, ->(v){v['SPEC CHECKSUMS']['Remote']='changed'},
     ->(v){v['EXTERNAL SOURCES']['Local'][:path]='https://other.test/spec'},
     ->(v){v['SPEC CHECKSUMS'].delete('Local')}].each do |change|
      after=Marshal.load(Marshal.dump(before));change.call(after)
      assert_raises(RuntimeError){check_pod_lock(before, after)}
    end
  end
end
